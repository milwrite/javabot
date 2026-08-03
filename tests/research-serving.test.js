const DashboardServer = require('../scripts/dashboard-server');
const {
    isSafeResearchFilename,
    serveRemoteResearchFile,
    buildHealthPayload
} = DashboardServer;

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  ✓ ${name}`);
    } catch (error) {
        failed += 1;
        console.error(`  ✗ ${name}`);
        console.error(`    ${error.message}`);
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function createResponseRecorder() {
    return {
        contentType: null,
        headers: {},
        body: null,
        type(value) {
            this.contentType = value;
            return this;
        },
        set(name, value) {
            this.headers[name] = value;
            return this;
        },
        send(value) {
            this.body = value;
            return this;
        }
    };
}

(async () => {
    console.log('\n🌐 TEST SUITE: Live Deep Research serving\n');

    await test('Only flat HTML and JSON research filenames are accepted', () => {
        assert(isSafeResearchFilename('new-report-20260803t120000000z.html'), 'valid report rejected');
        assert(isSafeResearchFilename('reports.json'), 'registry rejected');
        assert(!isSafeResearchFilename('../index.html'), 'path traversal accepted');
        assert(!isSafeResearchFilename('report.js'), 'unsupported extension accepted');
    });

    await test('Registry is fetched from the confirmed main branch without caching', async () => {
        const response = createResponseRecorder();
        let requested = null;
        let nextCalled = false;
        await serveRemoteResearchFile('reports.json', response, () => {
            nextCalled = true;
        }, async (repoPath, branch) => {
            requested = { repoPath, branch };
            return '[{"file":"new-report.html"}]';
        });

        assert(!nextCalled, 'registry unexpectedly fell through');
        assert(requested.repoPath === 'src/search/reports.json', 'wrong registry path requested');
        assert(requested.branch === 'main', 'registry did not use main');
        assert(response.contentType === 'application/json', 'registry content type is wrong');
        assert(response.headers['Cache-Control'] === 'no-store', 'registry can become stale');
        assert(response.body.includes('new-report.html'), 'registry body was not served');
    });

    await test('New report HTML is served from GitHub with a short cache', async () => {
        const response = createResponseRecorder();
        await serveRemoteResearchFile('new-report.html', response, () => {
            throw new Error('report unexpectedly fell through');
        }, async () => '<!doctype html><title>New report</title>');

        assert(response.contentType === 'text/html', 'report content type is wrong');
        assert(response.headers['Cache-Control'] === 'public, max-age=60', 'report cache policy is wrong');
        assert(response.body.includes('New report'), 'report body was not served');
    });

    await test('Missing or unsafe files fall through to the normal 404/static path', async () => {
        let fallthroughs = 0;
        const response = createResponseRecorder();
        await serveRemoteResearchFile('../secret.html', response, () => {
            fallthroughs += 1;
        }, async () => {
            throw new Error('unsafe path reached GitHub');
        });
        await serveRemoteResearchFile('missing.html', response, () => {
            fallthroughs += 1;
        }, async () => null);
        assert(fallthroughs === 2, 'missing/unsafe routes did not fall through');
    });

    await test('Health distinguishes a ready bot from a live degraded archive', () => {
        const ready = buildHealthPayload(
            { discordReady: true },
            { clients: 2, dbConnected: true, sessionId: 'session-ready' }
        );
        const degraded = buildHealthPayload(
            { discordReady: false, discordLoginFailed: true },
            { clients: 0, dbConnected: true, sessionId: 'session-degraded' }
        );

        assert(ready.status === 'ok', 'ready bot reported degraded');
        assert(ready.discordReady === true, 'ready bot omitted Discord readiness');
        assert(ready.clients === 2, 'health payload omitted connected clients');
        assert(degraded.status === 'degraded', 'offline bot reported healthy');
        assert(degraded.discordReady === false, 'degraded archive hid Discord failure');
        assert(degraded.dbConnected === true, 'degraded health lost database status');
    });

    await test('Degraded archive stays live while bot readiness returns 503', async () => {
        const server = new DashboardServer(0, () => ({ discordReady: false }));
        await server.start();

        try {
            const port = server.server.address().port;
            const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
            const readyResponse = await fetch(`http://127.0.0.1:${port}/api/ready`);
            const health = await healthResponse.json();
            const ready = await readyResponse.json();

            assert(healthResponse.status === 200, 'liveness endpoint took the archive offline');
            assert(health.status === 'degraded', 'liveness endpoint hid Discord degradation');
            assert(readyResponse.status === 503, 'readiness endpoint accepted an offline bot');
            assert(ready.discordReady === false, 'readiness response hid Discord failure');
        } finally {
            await server.stop();
        }
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
})();
