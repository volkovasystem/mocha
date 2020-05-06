'use strict';

const rewiremock = require('rewiremock/node');
const {createSandbox} = require('sinon');

describe('class WorkerPool', function() {
  let WorkerPool;
  let sandbox;
  let pool;
  let stats;
  let serializeJavascript;
  let serializer;
  let result;

  beforeEach(function() {
    sandbox = createSandbox();
    stats = {totalWorkers: 10, busyWorkers: 8, idleWorkers: 2, pendingTasks: 3};
    result = {failures: 0, events: []};
    pool = {
      terminate: sandbox.stub().resolves(),
      exec: sandbox.stub().resolves(result),
      stats: sandbox.stub().returns(stats)
    };
    serializer = {
      deserialize: sandbox.stub()
    };

    serializeJavascript = sandbox.spy(require('serialize-javascript'));
    WorkerPool = rewiremock.proxy(require.resolve('../../lib/pool'), {
      workerpool: {
        pool: sandbox.stub().returns(pool)
      },
      '../../lib/serializer': serializer,
      'serialize-javascript': serializeJavascript
    }).WorkerPool;

    // reset cache
    WorkerPool.resetOptionsCache();
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('static method', function() {
    describe('create()', function() {
      it('should return a WorkerPool instance', function() {
        expect(WorkerPool.create({foo: 'bar'}), 'to be a', WorkerPool);
      });

      describe('when passed no arguments', function() {
        it('should not throw', function() {
          expect(WorkerPool.create, 'not to throw');
        });
      });
    });

    describe('serializeOptions()', function() {
      describe('when passed no arguments', function() {
        it('should not throw', function() {
          expect(WorkerPool.serializeOptions, 'not to throw');
        });
      });

      it('should return a serialized string', function() {
        expect(WorkerPool.serializeOptions({foo: 'bar'}), 'to be a', 'string');
      });

      describe('when called multiple times with the same object', function() {
        it('should not perform serialization twice', function() {
          const obj = {foo: 'bar'};
          WorkerPool.serializeOptions(obj);
          WorkerPool.serializeOptions(obj);
          expect(serializeJavascript, 'was called once');
        });

        it('should return the same value', function() {
          const obj = {foo: 'bar'};
          expect(
            WorkerPool.serializeOptions(obj),
            'to be',
            WorkerPool.serializeOptions(obj)
          );
        });
      });
    });
  });

  describe('constructor', function() {
    it('should apply defaults', function() {
      expect(new WorkerPool(), 'to satisfy', {
        options: {
          workerType: 'process',
          forkOpts: {execArgv: process.execArgv},
          maxWorkers: expect.it('to be greater than or equal to', 1)
        }
      });
    });
  });

  describe('instance method', function() {
    let workerPool;

    beforeEach(function() {
      workerPool = WorkerPool.create();
    });

    describe('stats()', function() {
      it('should return the object returned by `workerpool.Pool#stats`', function() {
        expect(workerPool.stats(), 'to be', stats);
      });
    });

    describe('run()', function() {
      describe('when passed no arguments', function() {
        it('should reject', async function() {
          return expect(workerPool.run(), 'to be rejected with', {
            code: 'ERR_MOCHA_INVALID_ARG_TYPE'
          });
        });
      });

      describe('when passed a non-string filepath', function() {
        it('should reject', async function() {
          return expect(workerPool.run(123), 'to be rejected with', {
            code: 'ERR_MOCHA_INVALID_ARG_TYPE'
          });
        });
      });

      it('should serialize the options object', async function() {
        await workerPool.run('file.js', {foo: 'bar'});

        expect(pool.exec, 'to have a call satisfying', [
          'run',
          ['file.js', '{"foo":"bar"}']
        ]).and('was called once');
      });

      it('should deserialize the result', async function() {
        await workerPool.run('file.js', {foo: 'bar'});
        expect(serializer.deserialize, 'to have a call satisfying', [
          result
        ]).and('was called once');
      });
    });
  });
});
