import assert from 'node:assert/strict'
import test from 'node:test'

import {
    getRouterBasename,
    normalizePublicBasePath,
    withPublicBasePath,
} from '../src/utils/deployPaths.ts'
import {
    getEffectiveApiBaseUrl,
    normalizeApiBaseUrl,
} from '../src/utils/apiBaseUrl.ts'

test('normalizes public base paths for a /gridmen deployment', () => {
    assert.equal(normalizePublicBasePath('/gridmen'), '/gridmen/')
    assert.equal(normalizePublicBasePath('gridmen'), '/gridmen/')
    assert.equal(normalizePublicBasePath('/'), '/')
    assert.equal(normalizePublicBasePath(''), '/')
})

test('derives BrowserRouter basename from the Vite public base path', () => {
    assert.equal(getRouterBasename('/gridmen/'), '/gridmen')
    assert.equal(getRouterBasename('/gridmen'), '/gridmen')
    assert.equal(getRouterBasename('/'), undefined)
})

test('accepts same-origin deployment API base paths', () => {
    assert.equal(normalizeApiBaseUrl('/gridmen/'), '/gridmen')
    assert.equal(getEffectiveApiBaseUrl('/gridmen/'), '/gridmen')
    assert.equal(normalizeApiBaseUrl('https://example.test/gridmen/'), 'https://example.test/gridmen')
})

test('prefixes public assets with the Vite public base path', () => {
    assert.equal(withPublicBasePath('/shaders/hello/grid.glsl', '/gridmen/'), '/gridmen/shaders/hello/grid.glsl')
    assert.equal(withPublicBasePath('images/hello/hello.png', '/gridmen/'), '/gridmen/images/hello/hello.png')
    assert.equal(withPublicBasePath('/images/login.svg', '/'), '/images/login.svg')
})
