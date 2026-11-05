import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { clipGain, end, exportRange, newProject, placeClip, snapTime, splitClip, trimClip, type Clip, type Media } from '../../src/model'
function fixture() {
  const project = newProject()
  project.media = [{ id: 'media', duration: 30, kind: 'video', width: 1080, height: 1920, fps: 30 } as Media]
  const clip: Clip = { id: 'one', mediaId: 'media', trackId: project.tracks[0].id, start: 2, sourceIn: 0, sourceOut: 10, fadeIn: 1, fadeOut: 2 }
  project.clips = [clip]
  return { project, clip }
}
describe('timeline editing', () => {
  test('unset markers export from zero through the last clip', () => {
    const { project } = fixture()
    assert.deepEqual(exportRange(project), [0, 12])
    project.inPoint = 3
    assert.deepEqual(exportRange(project), [3, 12])
    project.outPoint = 8
    assert.deepEqual(exportRange(project), [3, 8])
  })
  test('split retains source offsets and outer fades', () => {
    const { project } = fixture()
    const result = splitClip(project, 'one', 6)
    assert.deepEqual(result.clips.map(c => [c.start, c.sourceIn, c.sourceOut, c.fadeIn, c.fadeOut]), [[2, 0, 4, 1, 0], [6, 4, 10, 0, 2]])
    assert.equal(project.clips.length, 1)
  })
  test('clips snap against neighbors without overwriting them', () => {
    const { project, clip } = fixture()
    const next = { ...clip, id: 'two', sourceOut: 5, fadeIn: 0, fadeOut: 0 }
    assert.equal(placeClip(project, next, 11.8, clip.trackId, .3).start, 12)
    assert.equal(placeClip(project, next, 7, clip.trackId, .3).start, 12)
    assert.equal(placeClip(project, next, 20, clip.trackId, .3).start, 20)
  })
  test('move and trim snap to markers and cross-track clip edges', () => {
    const { project, clip } = fixture()
    project.inPoint = 16
    project.outPoint = 24
    const next = { ...clip, id: 'two', sourceOut: 3, trackId: project.tracks[1].id }
    assert.equal(placeClip(project, next, 15.9, next.trackId, .3).start, 16)
    assert.equal(end(placeClip(project, next, 20.9, next.trackId, .3)), 24)
    assert.equal(end(trimClip(project, next, 'right', 12.15, .3)), 12)
    assert.equal(snapTime(23.9, project, null, .3), 24)
  })
  test('left trim preserves source/time mapping and does not pass a neighbor', () => {
    const { project, clip } = fixture()
    const trimmed = trimClip(project, clip, 'left', 4, .2)
    assert.deepEqual([trimmed.start, trimmed.sourceIn, end(trimmed)], [4, 2, 12])
    assert.equal(clipGain(clip, 2.5), .5)
    assert.equal(clipGain(clip, 11), .5)
  })
  test('trimming media shorter than the minimum trim length stays within its source', () => {
    const { project, clip } = fixture()
    project.media[0].duration = .025
    const short = { ...clip, start: 0, sourceOut: .025, fadeIn: 0, fadeOut: 0 }
    project.clips = [short]
    for (const desired of [-1, 0, .02, 1]) {
      for (const edge of ['left', 'right'] as const) {
        assert.deepEqual(trimClip(project, short, edge, desired, 0), short)
      }
    }
  })
  test('short split sections can extend without shrinking or crossing adjacent clips', () => {
    const { project, clip } = fixture()
    const split = splitClip(project, clip.id, clip.start + .025)
    const [left, right] = split.clips
    assert.deepEqual(trimClip(split, left, 'left', end(left), 0), left)
    assert.deepEqual(trimClip(split, left, 'right', end(left) + 1, 0), left)

    const isolated = { ...split, clips: [left] }
    assert.deepEqual(trimClip(isolated, left, 'right', left.start, 0), left)
    const extended = trimClip(isolated, left, 'right', right.start + 1, 0)
    assert.ok(end(extended) > end(left))
    assert.equal(extended.sourceIn, left.sourceIn)
  })
})
