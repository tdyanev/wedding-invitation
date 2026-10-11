const assert = require('assert'); const { makeEnv } = require('./gas-mock');
const crypto = require('crypto'); const id = () => crypto.randomUUID();
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('PASS', name); };

t('1 valid YES', () => { const e = makeEnv(); const r = e.post({ submissionId: id(), fullName: 'Ana Cruz', attending: 'YES', message: 'Congrats!' });
  assert.deepStrictEqual([r.ok, r.status], [true, 'created']); assert.strictEqual(e.rows.length, 2);
  assert.strictEqual(Object.prototype.toString.call(e.rows[1][0]), '[object Date]'); assert.deepStrictEqual(e.rows[1].slice(2), ['Ana Cruz', 'YES', 'Congrats!']);
  assert.deepStrictEqual(e.rows[0], ['Timestamp', 'Submission ID', 'Full Name', 'Attending', 'Message']); });
t('2 valid NO', () => { const e = makeEnv(); const r = e.post({ submissionId: id(), fullName: 'Ben', attending: 'NO', message: '' }); assert.ok(r.ok); assert.strictEqual(e.rows[1][3], 'NO'); });
t('3 message omitted', () => { const e = makeEnv(); const r = e.post({ submissionId: id(), fullName: 'Cy', attending: 'YES' }); assert.ok(r.ok); assert.strictEqual(e.rows[1][4], ''); });
t('4 empty / whitespace name rejected', () => { const e = makeEnv();
  for (const n of ['', '   ', '​', null, 42]) { const r = e.post({ submissionId: id(), fullName: n, attending: 'YES' }); assert.deepStrictEqual([r.ok, r.code, r.field], [false, 'VALIDATION', 'fullName']); }
  assert.strictEqual(e.rows.length, 1); });
t('5 attendance missing / invalid rejected', () => { const e = makeEnv();
  for (const a of [undefined, '', 'yes', 'MAYBE', true]) { const r = e.post({ submissionId: id(), fullName: 'D', attending: a }); assert.strictEqual(r.field, 'attending'); }
  assert.strictEqual(e.rows.length, 1); });
t('7 same name twice → two rows', () => { const e = makeEnv(); e.post({ submissionId: id(), fullName: 'Same Name', attending: 'YES' }); e.post({ submissionId: id(), fullName: 'Same Name', attending: 'NO' });
  assert.strictEqual(e.rows.length, 3); assert.notStrictEqual(e.rows[1][1], e.rows[2][1]); });
t('8 retry same submissionId → duplicate, one row', () => { const e = makeEnv(); const sid = id(); const p = { submissionId: sid, fullName: 'Eve', attending: 'YES' };
  assert.strictEqual(e.post(p).status, 'created'); assert.strictEqual(e.post(p).status, 'duplicate');
  assert.strictEqual(e.post({ ...p, submissionId: sid.toUpperCase() }).status, 'duplicate'); assert.strictEqual(e.rows.length, 2); });
t('10 backend validation: bad id / bad JSON / too long / wrong types', () => { const e = makeEnv();
  assert.strictEqual(e.post({ submissionId: 'abc', fullName: 'F', attending: 'YES' }).field, 'submissionId');
  assert.strictEqual(e.post('not json').code, 'BAD_REQUEST'); assert.strictEqual(e.post('[1]').code, 'BAD_REQUEST');
  assert.strictEqual(e.post({ submissionId: id(), fullName: 'x'.repeat(101), attending: 'YES' }).field, 'fullName');
  assert.strictEqual(e.post({ submissionId: id(), fullName: 'F', attending: 'YES', message: 'm'.repeat(1001) }).field, 'message');
  assert.strictEqual(e.post({ submissionId: id(), fullName: 'F', attending: 'YES', message: { a: 1 } }).field, 'message');
  assert.strictEqual(e.post('x'.repeat(10001)).code, 'BAD_REQUEST');
  assert.ok(e.post({ submissionId: id(), fullName: 'x'.repeat(100), attending: 'YES', message: 'm'.repeat(1000) }).ok);
  assert.strictEqual(e.rows.length, 2); });
t('10b sheet missing → NOT_CONFIGURED, append failure → retryable SERVER_ERROR', () => {
  assert.strictEqual(makeEnv({ noSheet: true }).post({ submissionId: id(), fullName: 'G', attending: 'YES' }).code, 'NOT_CONFIGURED');
  const e = makeEnv({ failAppend: true }); const r = e.post({ submissionId: id(), fullName: 'G', attending: 'YES' });
  assert.deepStrictEqual([r.code, r.retryable], ['SERVER_ERROR', true]); assert.strictEqual(e.stats().lockHeld, false, 'lock released after error');
  assert.ok(!e.logs.join().includes('"G"')); });
t('11 concurrency: lock held → BUSY (retryable), no write; critical section never re-entered', () => {
  const e = makeEnv({ lockBusy: true }); const r = e.post({ submissionId: id(), fullName: 'H', attending: 'YES' });
  assert.deepStrictEqual([r.code, r.retryable], ['BUSY', true]); assert.strictEqual(e.rows.length, 1);
  const e2 = makeEnv(); for (let i = 0; i < 25; i++) e2.post({ submissionId: id(), fullName: 'P' + i, attending: 'YES' });
  assert.strictEqual(e2.stats().maxCritical, 1); assert.strictEqual(e2.stats().lockHeld, false); assert.strictEqual(e2.rows.length, 26); });
t('12 formula injection neutralised', () => { const e = makeEnv();
  const evil = ['=IMPORTXML("http://x","//a")', '+1+1', '-2+3', '@SUM(A1)', '=HYPERLINK("http://evil","click")'];
  evil.forEach((v) => e.post({ submissionId: id(), fullName: v, attending: 'NO', message: v }));
  e.rows.slice(1).forEach((r, i) => { assert.strictEqual(r[2], "'" + evil[i]); assert.strictEqual(r[4], "'" + evil[i]); });
  e.post({ submissionId: id(), fullName: 'Ok', attending: 'YES', message: '\t=1+1' }); assert.strictEqual(e.rows.at(-1)[4], "'=1+1".replace("'", "'")); });
t('anti-spam: honeypot rejected, rate limit (retries exempt)', () => { const e = makeEnv();
  assert.strictEqual(e.post({ submissionId: id(), fullName: 'Bot', attending: 'YES', website: 'http://spam' }).code, 'REJECTED'); assert.strictEqual(e.rows.length, 1);
  const first = { submissionId: id(), fullName: 'R0', attending: 'YES' }; e.post(first);
  for (let i = 1; i < 30; i++) e.post({ submissionId: id(), fullName: 'R' + i, attending: 'YES' });
  const r = e.post({ submissionId: id(), fullName: 'R30', attending: 'YES' }); assert.deepStrictEqual([r.code, r.retryable], ['RATE_LIMITED', true]);
  assert.strictEqual(e.post(first).status, 'duplicate'); assert.strictEqual(e.rows.length, 31); });
t('logs contain no names or messages', () => { const e = makeEnv(); e.post({ submissionId: id(), fullName: 'Secret Person', attending: 'YES', message: 'private note' });
  e.post({ submissionId: id(), fullName: '', attending: 'YES' }); const l = e.logs.join('\n'); assert.ok(!/Secret|private note/.test(l)); assert.ok(/created/.test(l)); });
t('control chars stripped, newlines kept in message', () => { const e = makeEnv(); e.post({ submissionId: id(), fullName: ' Ana\u0000  \n Cruz ', attending: 'YES', message: 'line1\r\nline2\u0007' });
  assert.strictEqual(e.rows[1][2], 'Ana Cruz'); assert.strictEqual(e.rows[1][4], 'line1\nline2'); });
console.log(`\n${pass} backend tests passed`);
