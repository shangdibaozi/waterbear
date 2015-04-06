/**
 * Abstracts the execution state. That is, all the stuff required for running
 * blocks. It goes in here!
 *
 * The exported class `Process` is kind of similar to a Unix process in that
 * there is one shared memory, but it contains a bunch of "strands" (kind of
 * like threads) that may run concurrently.
 *
 * @author Eddie Antonio Santos @eddieantonio
 * Date:   March 2015
 */
window.WaterbearProcess = (function () {
    'use strict';

    var assert = console.assert.bind(console);

    /**
     * Information for execution of a single frame (as in "stack frame" or
     * even "activation record", if you will) of execution. Several frames
     * make up a strand.
     */
    function Frame(context, activeContainer, scope, continuationCallback) {
        this.context = context;
        this.activeContainer = activeContainer;
        this.scope = scope;
        this.shouldContinue = continuationCallback || null;
    }

    /**
     * Pseudo-property: the containers that belong to the underlying context.
     */
    Object.defineProperty(Frame.prototype, 'containers', {
        get: function () {
            return this.context.gatherContainers();
        }
    });

    /**
     * Pseudo-property: the first instruction of the active container
     */
    Object.defineProperty(Frame.prototype, 'firstInstruction', {
        get: function () {
            return this.activeContainer.firstInstruction;
        }
    });

    /**
     * Creates a new (usually root) frame from a <wb-contains> element.
     * That is, this frame does *NOT* have a context!.
     */
    Frame.createFromContainer = function createFromContainer(container, scope) {
        /* Note: this does not actually instantiate an actual Frame object.
         * Sneaky sneaky! */
        var actualScope = scope || Object.create(null);
        return {
            activeContainer: container,
            context: null,
            args: null,
            shouldContinue: null,
            scope: actualScope,
            /* Pseudo-properties. */
            firstInstruction: container.firstInstruction,
            containers: null,
        };
    };

    /**
     * Creates a new frame from the given <wb-context>, active on the given
     * container.
     */
    Frame.createFromContext = function (context, container, scope, callback) {
        return new Frame(context, container, scope, callback);
    };

    /**
     * Creates a new frame from an existing frame.
     */
    Frame.createFromFrame = function (frame) {
        return new Frame(frame.context,
                         frame.activeContainer,
                         frame.scope,
                         frame.shouldContinue);
    };



    /**
     * A single execution strand! Think of it as a thread: it keeps track of the
     * current scope (thus, "the stack"), and thus, has a bunch of nested
     * "frames" -- a stack frames!
     */
    function Strand(initialFrame, process) {
        this.process = process;
        this.currentInstruction = initialFrame.firstInstruction;

        this.frames = [initialFrame];

        /* Private use: */
        this.undertakenAction = null;
    }

    /**
     * Pseudo-property: currentFrame is the active (or top-most) frame in the
     * frames stack.
     */
    Object.defineProperty(Strand.prototype, 'currentFrame', {
        get: function () {
            return this.frames[0];
        }
    });

    /**
     * Pseudo-property: scope of the strand is the scope active in the
     * current frame.
     */
    Object.defineProperty(Strand.prototype, 'scope', {
        get: function () {
            return this.currentFrame.scope;
        }
    });

    /**
     * Runs the next instruction, updating the instruction pointer and scope
     * as appropriate.
     *
     * Returns: true if this strand has more instructions to execute.
     */
    Strand.prototype.doNext = function doNext() {
        assert(this.currentInstruction !== null,
               'Cannot `doNext` when current instruction undefined.');

        if (isContext(this.currentInstruction)) {
            /* This *WILL* set the next instruction. */
            this.undertakenAction = false;
            this.currentInstruction.run(this, this.currentFrame);
            assert(this.undertakenAction,
                  'API error: runtime function did not call one of ' +
                    'strand.{newFrame, newScope, newFrameHandler, newEventHandler, noOperation}');
        } else {
            assert(this.currentInstruction.tagName == 'WB-STEP');
            /* TODO: wrap this with error handling of some kind. */
            this.currentInstruction.run(this.scope);
            this.currentInstruction = this.next();
        }

        return this.currentInstruction !== null;
    };

    /**
     * Creates a new frame of execution without creating a new scope.
     */
    Strand.prototype.newFrame = function newFrame(container, continuationCallback) {
        this.pushNewFrameFromThisContext(container, this.scope, continuationCallback);
        this.undertakenAction = true;
    };

    /**
     * Creates a new frame of execution with a new scope. That is,
     * all new variables defined in this scope will disappear once this frame
     * has ended.
     */
    Strand.prototype.newScope = function newScope(container, continuationCallback) {

        /* Augment the current scope! */
        var scope = Object.create(this.scope);

        this.pushNewFrameFromThisContext(container, scope, continuationCallback);
        this.undertakenAction = true;
    };

    /**
     * Starts a new thread whose blocks will be run before each animation
     * frame.
     *
     * NOTE: the "frame" in "frame handler" is for **animation** frames. Do
     * not confuse this with execution frames (the Frame class in this file).
     */
    Strand.prototype.newFrameHandler = function newFrameHandler(container) {
        /* Delegate to the process. */
        this.process.addFrameHandler(container);

        /* Just go on our merry way. */
        this.undertakenAction = true;
        this.currentInstruction = this.currentInstruction.next();
    };

    /**
     * Registers a new event handler for the given event.
     *
     * TODO: Write more docs for this.
     */
    Strand.prototype.newEventHandler = function newEventHandler(event, container) {
        /* FIXME: Write this! */
        assert(false, 'Not implemented.');
        this.undertakenAction = true;
        this.currentInstruction = this.currentInstruction.next();
    };

    /**
     * Starts a new strand, seperate from this one.  It inherits the current
     * scope.
     */
    Strand.prototype.newStrand = function newStrand(container) {
        /* FIXME: Write this! */
        assert(false, 'Not implemented.');
        this.undertakenAction = true;
        this.currentInstruction = this.currentInstruction.next();
    };

    /**
     * Explicitly specifies that no action be undertaken.
     * 
     * This must be called to silence the warning that would otherwise be
     * raised.
     */
    Strand.prototype.noOperation = function noOperation() {
        this.undertakenAction = true;
        this.currentInstruction = this.currentInstruction.next();
    };

    /* Private use: */

    /** Get the next instruction in this strand.  */
    Strand.prototype.next = function next() {
        var nextInstruction;

        /* Delegate to the block itself. */
        nextInstruction = this.currentInstruction.next();

        assert(nextInstruction === null || typeof nextInstruction.run === 'function',
               'Block does not have a callable property `run`');

        /* Handle frame stuff here. */
        if (nextInstruction === null) {
            return this.switchFrame();
        }

        return nextInstruction;
    };

    /** Add a frame to the execution stack. */
    Strand.prototype.pushNewFrameFromThisContext = function (container, scope, callback) {
        var frame, context;
        context = this.currentInstruction;

        assert(isContext(context));
        frame = Frame.createFromContext(context, container, scope, callback);
        this.frames.unshift(frame);
        
        this.currentInstruction = this.currentFrame.firstInstruction;
    };

    /**
     * Called when there's a possibility to restart this frame, or yield to
     * the previous frame.
     *
     * Returns the next instruction to run.
     */
    Strand.prototype.switchFrame = function switchFrame() {
        var oldFrame = this.currentFrame;
        /* Ask shouldContinue() if we should switch to a new container-- if
         * shouldContinue exists! */
        var nextContainer = oldFrame.shouldContinue && oldFrame.shouldContinue();

        assert(nextContainer === null || nextContainer.tagName === 'WB-CONTAINS');

        if (nextContainer === null) {
            /* This frame has been exhausted! */
            this.frames.shift();
            return oldFrame.context && oldFrame.context.next();
        } else {
            this.frames[0] = Frame.createFromFrame(oldFrame);
            return this.currentFrame.firstInstruction;
        }
    };

    /**
     * Creates the root strand -- that is, the strand from which all other
     * strands originate from.
     */
    Strand.createRootStrand = function createRootStrand(process) {
        var globalScope = {},
            /* FIXME: THIS DOM STUFF DOES NOT BELONG HERE! */
            container = dom.find('wb-workspace > wb-contains'),
            frame = Frame.createFromContainer(container, globalScope);

        assert(!!process, "Must be called with a process.");

        return new Strand(frame, process);
    };


    /**
     * A strand that whose root frame can be run many, many times.
     * Used for event and frame handlers.
     *
     * @see Strand for constructor arguments.
     */
    function ReusableStrand(initialFrame) {
        /* Call super() constructor. */
        Strand.apply(this, arguments);

        this.rootFrame = initialFrame;
    }

    /* Inherit methods from Strand. */
    ReusableStrand.prototype = Object.create(Strand.prototype);

    /**
     * Runs everything nested within synchronously.
     */
    ReusableStrand.prototype.startSync = function () {
        var thereAreMoreInstructions;

        /* Reset to the initial frame. */
        this.resetFrames();

        do {
            thereAreMoreInstructions = this.doNext();
        } while (thereAreMoreInstructions);
    };

    /**
     * Unsupported operation.
     */
    ReusableStrand.prototype.newFrameHandler = function () {
        throw new Error("Nesting frame handlers is a bad idea, m'kay?");
    };

    /**
     * Unsupported operation.
     */
    ReusableStrand.prototype.newEventHandler = function () {
        throw new Error("Refusing to create events within an event/frame.");
    };

    /*
     * Private methods!
     */

    /**
     * Clears all frames in the frame stack EXCEPT for the root frame.
     * The next instruction is set as the first instruction in the root frame.
     */
    ReusableStrand.prototype.resetFrames = function () {
        this.frames = [Frame.createFromFrame(this.rootFrame)];
        this.currentInstruction =  this.currentFrame.firstInstruction;
    };



    /**
     * Encapsulates the execution of a Waterbear program. There may be several
     * "threads", so this encompasses all of them. ALL OF THEM.
     *
     * This is a "one-time use" object! This means that once `start` is
     * called, it cannot be started all over again. Similarly, once
     * `terminate` is called, you can consider this object useless.
     */
    function Process() {
        var started = false;

        /* Set some essential state. */
        this.strands = [];

        /* Related to frame handlers -- probably should split this out into
         * its own class. */
        this.perFrameHandlers = [];
        this.lastTime = new Date().valueOf();
        this.currentAnimationFrameHandler = null;

        this.currentStrand = null;
        this.paused = false;

        /* Disable breakpoints. */
        this.shouldBreak = false;
        /* Run as quickly as possible. */
        this.delay = 0;
        this.nextTimeout = null;

        /* `doNextStep` is the same as `nextStep`, but it is bound to this
         * object, so it never forgets who it belongs to, even when used in
         * setTimeout/setImmediate! */
        this.doNextStep = this.nextStep.bind(this);

        /*
         * This `started` tomfoolery ensures that the Process object is a
         * "one-time use" object.  Once it's started, it can't be started
         * again; and once it's terminated, it's gone for good. Want to start
         * again? Instantiate a brand new Process()!
         */
        Object.defineProperties(this, {
            /* `started` is trapped in this closure, thus it can only be
             * changed in this constructor, or any function defined within this
             * constructor. */
            started: {
                get: function () { return started; },
                enumerable: true
            },
            /* Once this is called, started can never be `false`. */
            setStarted: {
                value: function () { started = true; },
                enumerable: false
            }
        });
    }

    /**
     * Starts (asynchronous!) execution from scratch. Can only be called once.
     */
    Process.prototype.start = function start() {
        assert(!this.started, 'Waterbear already started!');
        this.setStarted();

        /* NOTE: There was a plan to start a process on any arbitrary
         * instruction, but it didn't seem to be as useful as I had first
         * thought. */
        this.currentStrand = Strand.createRootStrand(this);

        this.strands.push(this.currentStrand);

        /* This starts asynchronous execution. */
        this.resumeAsync();

        return this;
    };

    /**
     * Resume executing immediately. Execution is as fast as the rate given to
     * `setRate` (default: unlimited).
     */
    Process.prototype.resumeAsync = function resumeAsync() {
        assert(this.started);

        this.paused = false;
        this.nextTimeout = enqueue(this.doNextStep);
        return this;
    };

    /**
     * Requests execution to pause before the next instruction.
     */
    Process.prototype.pause = function pause() {
        assert(this.started);
        this.paused = true;
        this.cancelNextTimeout();
        return this;
    };

    /**
     * Sets rate of execution in milliseconds / instruction.
     * If rate is not provided or undefined, the rate is unlimited.
     */
    Process.prototype.setRate = function setRate(rate) {
        if (rate === undefined) {
            this.delay = 0;
        } else {
            assert((+rate) > 0, 'Must provide positive number for rate.');
            this.delay = +rate;
        }
        return this;
    };

    /**
     * Requests to cleanly terminates the current process.
     * Once this has happened, this process should no longer be used.
     * `cb` is called once the process has cleanly terminated.
     */
    Process.prototype.terminate = function terminate(cb) {
        assert(this.started);
        this.pause();
        this.clearPerFrameHandlers();
        return this;
    };

    /**
     * Enables all breakpoints. Execution will pause on all breakpoints.
     */
    Process.prototype.enableBreakpoints = function enableBreakpoints() {
        this.shouldBreak = true;
        return this;
    };

    /**
     * Disables all breakpoints. Execution will continue regardless if there
     * is any breakpoint set on an instruction.
     */
    Process.prototype.disableBreakpoints = function disableBreakpoints() {
        this.shouldBreak = false;
        return this;
    };

    /** Internal methods **/

    /**
     * Note: the constructor should bind an alias to this method called
     * `doNextStep` which simply calls this but BINDS `this` TO THE METHOD
     * CALL (which is the only way anything will ever work :/).
     */
    Process.prototype.nextStep = function nextStep() {
        var hasNext;
        if (this.paused) {
            return;
        }

        /* TODO: Decide if we should pause at this instruction. */
        /* TODO: Decide if we should switch to a different strand. */

        hasNext = this.currentStrand.doNext();

        if (hasNext) {
            /* Setup the next step to run after delay. */
            this.nextTimeout = setTimeout(this.doNextStep, this.delay);
        } else {
            /* TODO: this strand is now terminated... */
            /* Remove it from the list and... :/ */
        }
    };

    /**
     * Runs blocks during requestAnimationFrame().
     */
    Process.prototype.handleAnimationFrame = function onAnimationFrame() {
        var currTime = new Date().valueOf();

        /* Do I dare change these not quite global variables? */
        runtime.control._elapsed = currTime - this.lastTime;
        /* FIXME: This does not trivially allow for multiple eachFrame
         * handlers! */
        runtime.control._frame++;
        /* Why, yes, I do dare. */

        this.lastTime = currTime;

        if (this.delay === 0) {
            /* Run ALL of the frame handlers synchronously. */
            this.perFrameHandlers.forEach(function (strand){
                strand.startSync();
            });
        } else {
            throw new Error('Slow down frame handler not implemented.');
        }

        /* Enqueue the next call for this function. */
        this.currentAnimationFrameHandler =
            requestAnimationFrame(this.onAnimationFrame);
    };

    /**
     * Register this container as a frame handler.
     */
    Process.prototype.addFrameHandler = function addFrameHandler(container) {
        if (this.perFrameHandlers.length > 0) {
            throw new Error('Cannot install more than one per-frame handler. Yet!');
        }

        var frame = Frame.createFromContainer(container, this.currentStrand.scope);
        var strand = new ReusableStrand(frame, this);
        this.perFrameHandlers.push(strand);

        this.startEventLoop();
    };

    /**
     * Starts requestAnimationFrame loop.
     */
    Process.prototype.startEventLoop = function() {
        runtime.control._frame = 0;
        runtime.control._sinceLastTick = 0;

        assert(this.perFrameHandlers.length > 0,
               'Must have at least one per-frame handler defined.');

        /* Alias to handleAnimationFrame, but bound to `this`. */
        this.onAnimationFrame = this.handleAnimationFrame.bind(this);

        if (!this.currentAnimationFrameHandler){
            this.currentAnimationFrameHandler =
                requestAnimationFrame(this.onAnimationFrame);
        }
    };

    /**
     * Cancels all per-frame handlers, and the current
     * `requestAnimationFrame`.
     */
    Process.prototype.clearPerFrameHandlers = function () {
        this.perFrameHandlers = [];
        this.lastTime = new Date().valueOf();
        cancelAnimationFrame(this.currentAnimationFrameHandler);
        this.currentAnimationFrameHandler = null;
    };

    /**
     * Prevents the next callback from running.
     */
    Process.prototype.cancelNextTimeout = function cancelNextTimeout() {
        if (this.nextTimeout !== null) {
            clearTimeout(this.nextTimeout);
            this.nextTimeout = null;
        }
        return this;
    };

    /**
     * Execute `fn` asynchronously. Its execution will happen as soon as
     * possible, but note that it may yield to several other "threads".
     */
    function enqueue(fn) {
        /* FIXME #1085: Use setImmediate or equivalent. */
        return setTimeout(fn, 0);
    }


    /* Returns true if it's a context block. */
    function isContext(block) {
        /* FIXME: This probably should NOT rely on the DOM. Probably. */
        return block.tagName === 'WB-CONTEXT';
    }


    /* This is the export of the module. */
    return Process;
}());
