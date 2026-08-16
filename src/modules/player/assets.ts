import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface PlayerAsset {
  path: string
  contentType: string
}

const nodeModules = resolve(process.cwd(), 'node_modules')
const bundledAssets = resolve(process.cwd(), 'assets', 'player')
const assets = new Map<string, PlayerAsset>([
  ['artplayer-5.3.0.js', {
    path: resolve(nodeModules, 'artplayer', 'dist', 'artplayer.js'),
    contentType: 'application/javascript; charset=utf-8'
  }],
  ['dash-5.0.3.min.js', {
    path: resolve(nodeModules, 'dashjs', 'dist', 'modern', 'umd', 'dash.all.min.js'),
    contentType: 'application/javascript; charset=utf-8'
  }],
  ['dplayer-1.27.2-nuoxi4n.min.js', {
    path: resolve(bundledAssets, 'DPlayer.min.js'),
    contentType: 'application/javascript; charset=utf-8'
  }],
  ['flv-1.6.2.min.js', {
    path: resolve(nodeModules, 'flv.js', 'dist', 'flv.min.js'),
    contentType: 'application/javascript; charset=utf-8'
  }],
  ['hls-1.6.0.min.js', {
    path: resolve(nodeModules, 'hls.js', 'dist', 'hls.min.js'),
    contentType: 'application/javascript; charset=utf-8'
  }]
])

export async function readPlayerAsset(name: string): Promise<{
  body: Uint8Array<ArrayBuffer>
  contentType: string
} | null> {
  const asset = assets.get(name)
  if (!asset) return null
  return {
    body: Uint8Array.from(await readFile(asset.path)),
    contentType: asset.contentType
  }
}
