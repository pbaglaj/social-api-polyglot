import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityDaily } from '../models/ActivityDaily.js';

test('ActivityDaily model validates reactionsGiven map', () => {
  const doc = new ActivityDaily({
    day: new Date(),
    authorId: 1,
    postsCreated: 5,
    reactionsGiven: {
      like: 10,
      heart: 2
    }
  });

  const err = doc.validateSync();
  assert.equal(err, undefined, 'Validation should pass with valid data');

  const reactions = doc.reactionsGiven as Map<string, number>;
  assert.equal(reactions.get('like'), 10);
  assert.equal(reactions.get('heart'), 2);
});

test('ActivityDaily model enforces required fields', () => {
  const doc = new ActivityDaily({});
  const err = doc.validateSync();
  
  assert.ok(err, 'Validation should fail when required fields are missing');
  assert.ok(err.errors['day'], 'Missing day should throw validation error');
  assert.ok(err.errors['authorId'], 'Missing authorId should throw validation error');
});
