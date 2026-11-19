import assert from 'node:assert/strict';
import test from 'node:test';
import { refusal } from '../examples/milestones-evolution/gh-readonly.mjs';

// No call is made here: this is the decision alone.
test('the read-only gh passes reads', () => {
  for (const args of [
    ['api', '-X', 'GET', 'repos/o/n/milestones'],
    ['api', '-X', 'GET', '--paginate', '--slurp', '-f', 'state=open', 'repos/o/n/issues'],
    ['api', 'repos/o/n'],
    ['api', 'graphql', '-f', 'query=query { viewer { login } }'],
    ['api', 'graphql', '-f', 'query=\n  # which repos\n  { repository(owner: "o", name: "n") { id } }'],
    ['auth', 'status'],
    ['--version'],
  ]) assert.equal(refusal(args), null, args.join(' '));
});

test('the read-only gh refuses anything that could write', () => {
  for (const [args, why] of [
    [['api', '-X', 'PATCH', 'repos/o/n/issues/1', '-F', 'milestone=2'], /PATCH/],
    [['api', '-X', 'POST', 'repos/o/n/milestones', '-f', 'title=x'], /POST/],
    [['api', '-X', 'DELETE', 'repos/o/n/milestones/3'], /DELETE/],
    [['api', '--method=PUT', 'repos/o/n/x'], /PUT/],
    [['api', '-XPATCH', 'repos/o/n/x'], /PATCH/],
    [['api', '-X', 'patch', 'repos/o/n/x'], /PATCH/],
    // gh's own default with fields and no method.
    [['api', 'repos/o/n/issues', '-f', 'title=x'], /POST/],
    [['api', '-X', 'GET', '--input', '-', 'repos/o/n/x'], /with a body/],
    [['api', 'graphql', '-f', 'query=mutation { closeIssue(input: {}) { clientMutationId } }'], /not plainly a query/],
    [['api', 'graphql', '-f', 'query=  # tidy up\n  mutation M { x }'], /not plainly a query/],
    [['api', 'graphql', '-f', 'query=query Q { viewer { login } } mutation M { x }', '-f', 'operationName=M'], /not plainly a query/],
    [['api', 'graphql', '--input', '-'], /not plainly a query/],
    [['api', 'graphql'], /not plainly a query/],
    [['issue', 'close', '1'], /gh issue is not a call/],
    [['pr', 'merge', '1'], /gh pr is not a call/],
  ]) assert.match(refusal(args) ?? 'passed', why, args.join(' '));
});
