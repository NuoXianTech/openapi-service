import type { ArtplayerOptions, DplayerOptions } from './types.js'

const ASSET_BASE = '/v1/player/assets'
const HLS_JS_URL = `${ASSET_BASE}/hls-1.6.0.min.js`
const FLV_JS_URL = `${ASSET_BASE}/flv-1.6.2.min.js`
const DASH_JS_URL = `${ASSET_BASE}/dash-5.0.3.min.js`
const DPLAYER_JS_URL = `${ASSET_BASE}/dplayer-1.27.2-nuoxi4n.min.js`
const ARTPLAYER_JS_URL = `${ASSET_BASE}/artplayer-5.3.0.js`

function jsonScriptValue(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function renderDplayerHTML(options: DplayerOptions): string {
  const hiddenControls = options.hideplay
    ? `.dplayer-controller,.dplayer-controller-mask,.dplayer-menu,.dplayer-mask{display:none!important}`
    : ''
  return `<!DOCTYPE html>
<html lang="${options.lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta http-equiv="X-UA-Compatible" content="IE=11">
  <meta name="referrer" content="no-referrer">
  <title>视频播放器</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body,html{width:100%;height:100%;overflow:hidden;background:#000}#player-container{position:relative;width:100%;height:100%}${hiddenControls}</style>
</head>
<body>
  <div id="player-container"></div>
  <script src="${HLS_JS_URL}"></script>
  <script src="${FLV_JS_URL}"></script>
  <script src="${DASH_JS_URL}"></script>
  <script src="${DPLAYER_JS_URL}"></script>
  <script>
    document.addEventListener('DOMContentLoaded',function(){
      try {
        const player=new DPlayer({
          container:document.getElementById('player-container'),
          live:${jsonScriptValue(options.live)},
          muted:${jsonScriptValue(options.muted)},
          autoplay:${jsonScriptValue(options.autoplay)},
          loop:${jsonScriptValue(options.loop)},
          lang:${jsonScriptValue(options.lang)},
          volume:${jsonScriptValue(options.volume)},
          video:{url:${jsonScriptValue(options.url)},type:${jsonScriptValue(options.type)},pic:${jsonScriptValue(options.cover)}}
        });
        window.addEventListener('resize',function(){player.resize()});
      } catch (error) { console.error('播放器初始化失败：',error) }
    });
  </script>
</body>
</html>`
}

export function renderArtplayerHTML(options: ArtplayerOptions): string {
  const hiddenControls = options.hideplay ? '.art-controls{display:none!important}' : ''
  return `<!DOCTYPE html>
<html lang="${options.lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta http-equiv="X-UA-Compatible" content="IE=11">
  <meta name="referrer" content="no-referrer">
  <title>视频播放器</title>
  <style>body,html{margin:0;padding:0;width:100%;height:100%;overflow:hidden}.player-container{width:100%;height:100%}${hiddenControls}</style>
  <script src="${HLS_JS_URL}"></script>
  <script src="${FLV_JS_URL}"></script>
  <script src="${DASH_JS_URL}"></script>
</head>
<body>
  <div class="player-container"></div>
  <script src="${ARTPLAYER_JS_URL}"></script>
  <script>
    const art=new Artplayer({
      id:${jsonScriptValue(options.id)},container:'.player-container',url:${jsonScriptValue(options.url)},
      type:${jsonScriptValue(options.type)},lang:${jsonScriptValue(options.lang)},poster:${jsonScriptValue(options.poster)},
      theme:${jsonScriptValue(options.theme)},volume:${jsonScriptValue(options.volume)},isLive:${jsonScriptValue(options.islive)},
      muted:${jsonScriptValue(options.muted)},autoplay:${jsonScriptValue(options.autoplay)},autoPlayback:${jsonScriptValue(options.autoplayback)},
      autoMini:${jsonScriptValue(options.automini)},loop:${jsonScriptValue(options.loop)},flip:${jsonScriptValue(options.flip)},
      playbackRate:${jsonScriptValue(options.playbackrate)},aspectRatio:${jsonScriptValue(options.aspectratio)},setting:${jsonScriptValue(options.setting)},
      hotkey:${jsonScriptValue(options.hotkey)},pip:${jsonScriptValue(options.pip)},mutex:${jsonScriptValue(options.mutex)},
      fullscreen:${jsonScriptValue(options.fullscreen)},fullscreenWeb:${jsonScriptValue(options.fullscreenweb)},
      miniProgressBar:${jsonScriptValue(options.miniprogressbar)},playsInline:${jsonScriptValue(options.playsinline)},
      customType:{
        m3u8:function(video,url,instance){
          if(Hls.isSupported()){if(instance.hls)instance.hls.destroy();const hls=new Hls();hls.loadSource(url);hls.attachMedia(video);instance.hls=hls;instance.on('destroy',function(){hls.destroy()})}
          else if(video.canPlayType('application/vnd.apple.mpegurl'))video.src=url;
          else instance.notice.show='Unsupported playback format: m3u8';
        },
        flv:function(video,url,instance){
          if(flvjs.isSupported()){if(instance.flv)instance.flv.destroy();const flv=flvjs.createPlayer({type:'flv',url});flv.attachMediaElement(video);flv.load();instance.flv=flv;instance.on('destroy',function(){flv.destroy()})}
          else instance.notice.show='Unsupported playback format: flv';
        },
        mpd:function(video,url,instance){
          if(dashjs.supportsMediaSource()){if(instance.dash)instance.dash.destroy();const dash=dashjs.MediaPlayer().create();dash.initialize(video,url,instance.option.autoplay);instance.dash=dash;instance.on('destroy',function(){dash.destroy()})}
          else instance.notice.show='Unsupported playback format: mpd';
        }
      }
    });
  </script>
</body>
</html>`
}
