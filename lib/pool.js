'use strict';

const serializeJavascript = require('serialize-javascript');
const workerpool = require('workerpool');
const {deserialize} = require('./serializer');
const debug = require('debug')('mocha:parallel:pool');
const {cpus} = require('os');
const {createInvalidArgumentTypeError} = require('./errors');

const WORKER_PATH = require.resolve('./worker.js');

/**
 * A mapping of Mocha `Options` objects to serialized values.
 *
 * This is helpful because we tend to same the same options over and over
 * over IPC.
 * @type {WeakMap<Options,string>}
 */
let optionsCache = new WeakMap();

/**
 * Count of CPU cores
 */
const CPU_COUNT = cpus().length;

/**
 * Default max number of workers.
 *
 * We are already using one core for the main process, so assume only _n - 1_ are left.
 *
 * This is a reasonable default, but YMMV.
 */
const DEFAULT_MAX_WORKERS = CPU_COUNT - 1;

/**
 * These options are passed into the [workerpool](https://npm.im/workerpool) module.
 * @type {Partial<WorkerPoolOptions>}
 */
const WORKER_POOL_DEFAULT_OPTS = {
  // use child processes, not worker threads!
  workerType: 'process',
  // ensure the same flags sent to `node` for this `mocha` invocation are passed
  // along to children
  forkOpts: {execArgv: process.execArgv},
  maxWorkers: DEFAULT_MAX_WORKERS
};

/**
 * A wrapper around a third-party worker pool implementation.
 */
class WorkerPool {
  constructor(opts = WORKER_POOL_DEFAULT_OPTS) {
    const maxWorkers = Math.max(1, opts.maxWorkers);

    if (maxWorkers < 2) {
      debug(
        'not enough CPU cores available (%d) to run multiple jobs; avoid --parallel on this machine',
        CPU_COUNT
      );
    } else if (maxWorkers >= CPU_COUNT) {
      debug(
        '%d concurrent job(s) requested, but only %d core(s) available',
        maxWorkers,
        CPU_COUNT
      );
    }
    debug(
      'run(): starting worker pool of max size %d, using node args: %s',
      maxWorkers,
      process.execArgv.join(' ')
    );

    this.options = Object.assign({}, opts, {maxWorkers});
    this._pool = workerpool.pool(WORKER_PATH, this.options);
  }

  /**
   * Terminates all workers in the pool.
   * @param {boolean} [force] - Whether to force-kill workers. By default, lets workers finish their current task before termination.
   * @private
   * @returns {Promise<void>}
   */
  async terminate(force = false) {
    return this._pool.terminate(force);
  }

  /**
   * Adds a test file run to the worker pool queue for execution by a worker process.
   *
   * Handles serialization/deserialization.
   *
   * @param {string} filepath - Filepath of test
   * @param {Options} [options] - Options for Mocha instance
   * @private
   * @returns {Promise<SerializedWorkerResult>}
   */
  async run(filepath, options = {}) {
    if (!filepath || typeof filepath !== 'string') {
      throw createInvalidArgumentTypeError(
        'Expected a non-empty filepath',
        'filepath',
        'string'
      );
    }
    const serializedOptions = WorkerPool.serializeOptions(options);
    const result = await this._pool.exec('run', [filepath, serializedOptions]);
    return deserialize(result);
  }

  /**
   * Returns stats about the state of the worker processes in the pool.
   *
   * Used for debugging.
   *
   * @private
   */
  stats() {
    return this._pool.stats();
  }

  /**
   * Instantiates a {@link WorkerPool}.
   */
  static create(...args) {
    return new WorkerPool(...args);
  }

  /**
   * Given Mocha options object `opts`, serialize into a format suitable for
   * transmission over IPC.
   *
   * @param {Options} [opts] - Mocha options
   * @private
   * @returns {string} Serialized options
   */
  static serializeOptions(opts = {}) {
    if (!optionsCache.has(opts)) {
      const serialized = serializeJavascript(opts, {
        unsafe: true, // this means we don't care about XSS
        ignoreFunction: true // do not serialize functions
      });
      optionsCache.set(opts, serialized);
      debug(
        'serializeOptions(): serialized options %O to: %s',
        opts,
        serialized
      );
    }
    return optionsCache.get(opts);
  }

  /**
   * Resets internal cache of serialized options objects.
   *
   * For testing/debugging
   * @private
   */
  static resetOptionsCache() {
    optionsCache = new WeakMap();
  }
}

exports.WorkerPool = WorkerPool;
