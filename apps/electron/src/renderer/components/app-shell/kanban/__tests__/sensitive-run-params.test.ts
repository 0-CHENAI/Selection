import { describe, expect, it } from 'bun:test'
import { buildSensitiveRunParams, sensitiveRunParamNames } from '../sensitive-run-params'

describe('sensitive run params', () => {
  it('collects only named sensitive params from the loaded task definition', () => {
    expect(sensitiveRunParamNames({
      params: [
        { name: 'token', sensitive: true },
        { name: 'region', sensitive: false },
        { name: ' secret ', sensitive: true },
        { sensitive: true },
      ],
    })).toEqual(['token', 'secret'])
  })

  it('fails closed until every sensitive value has been re-entered', () => {
    expect(buildSensitiveRunParams(['token', 'secret'], { token: 'abc', secret: ' ' })).toEqual({
      missing: ['secret'],
    })
    expect(buildSensitiveRunParams(['token', 'secret'], { token: 'abc', secret: 'xyz' })).toEqual({
      missing: [],
      params: { token: 'abc', secret: 'xyz' },
    })
  })
})
