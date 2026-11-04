// Scoped styles for the overlay. Everything lives under .whale-mate so the host UI is untouched.
export const STYLE = `
.whale-mate{position:fixed;inset:0;pointer-events:none;contain:layout style;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.whale-mate__canvas{position:fixed;left:0;top:0;pointer-events:none;touch-action:none;will-change:transform}
.whale-mate__bubble{position:fixed;left:0;top:0;max-width:250px;padding:9px 13px;border-radius:14px;background:#fff;color:#1d2440;
  font-size:13px;line-height:1.55;box-shadow:0 6px 24px rgba(31,41,92,.18),0 1px 3px rgba(31,41,92,.12);border:1px solid rgba(98,113,190,.18);
  white-space:pre-wrap;word-break:break-word;pointer-events:none;animation:whale-mate-pop .18s ease-out}
.whale-mate__bubble::after{content:"";position:absolute;left:50%;bottom:-7px;width:12px;height:12px;margin-left:-6px;background:inherit;
  border-right:1px solid rgba(98,113,190,.18);border-bottom:1px solid rgba(98,113,190,.18);transform:rotate(45deg)}
.whale-mate__bubble.is-below::after{bottom:auto;top:-7px;transform:rotate(225deg)}
.whale-mate__bubble.is-thinking{display:flex;gap:5px;padding:12px 15px}
.whale-mate__bubble.is-thinking i{width:7px;height:7px;border-radius:50%;background:#7d8fd8;animation:whale-mate-dot 1.2s infinite ease-in-out}
.whale-mate__bubble.is-thinking i:nth-child(2){animation-delay:.15s}.whale-mate__bubble.is-thinking i:nth-child(3){animation-delay:.3s}
.whale-mate__menu{position:fixed;min-width:150px;padding:5px;border-radius:12px;background:#fff;color:#1d2440;pointer-events:auto;
  box-shadow:0 10px 30px rgba(31,41,92,.22);border:1px solid rgba(98,113,190,.2);display:flex;flex-direction:column}
.whale-mate__menu[hidden],.whale-mate__bubble[hidden]{display:none}
.whale-mate__menu button{all:unset;cursor:pointer;padding:7px 11px;border-radius:8px;font-size:13px}
.whale-mate__menu button:hover{background:#eef1fc}
.whale-mate__menu.whale-mate__wheel{padding:0;background:none;border:0;box-shadow:none;border-radius:50%;animation:whale-mate-wheel .14s ease-out;-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px)}
@keyframes whale-mate-wheel{from{transform:scale(.82);opacity:0}}
.whale-mate__wheel-svg{display:block;overflow:visible;filter:drop-shadow(0 6px 16px rgba(31,41,92,.16));font:13px/1 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;user-select:none}
.whale-mate__seg{cursor:pointer;outline:none}
.whale-mate__seg path{fill:rgba(255,255,255,.7);stroke:rgba(98,113,190,.28);stroke-width:1;transition:fill .12s}
.whale-mate__seg text{fill:#1d2440;pointer-events:none;font-weight:600;paint-order:stroke;stroke:rgba(255,255,255,.75);stroke-width:3px;stroke-linejoin:round}
.whale-mate__seg text.is-long{font-size:11.5px}
.whale-mate__seg.is-mode path{fill:rgba(226,231,252,.78)}
.whale-mate__seg.is-mode text{fill:#4253b8}
.whale-mate__seg:hover path,.whale-mate__seg:focus-visible path{fill:rgba(91,111,214,.88);stroke:#5b6fd6}
.whale-mate__seg:hover text,.whale-mate__seg:focus-visible text{fill:#fff;stroke:none}
.whale-mate__hub{cursor:pointer;outline:none}
.whale-mate__hub circle{fill:rgba(91,111,214,.9)}
.whale-mate__hub text{fill:#fff;font-size:12px;font-weight:600;pointer-events:none}
.whale-mate__library{width:min(372px,calc(100vw - 16px));max-height:calc(100vh - 16px);box-sizing:border-box;gap:8px;padding:12px 12px 10px;border-radius:16px}
.whale-mate__lib-head{display:flex;align-items:center;justify-content:space-between;padding:0 2px}
.whale-mate__lib-head strong{font-size:15px}
.whale-mate__menu .whale-mate__lib-x{width:28px;height:28px;padding:0;display:grid;place-items:center;font-size:20px;line-height:1;border-radius:50%;opacity:.7}
.whale-mate__library input{font:13px system-ui;padding:8px 11px;border:1px solid rgba(98,113,190,.35);border-radius:10px;background:rgba(120,140,220,.06);color:inherit;min-width:0;outline:none}
.whale-mate__library input:focus{border-color:#657de0;box-shadow:0 0 0 3px rgba(101,125,224,.18)}
.whale-mate__tabs{display:flex;flex-wrap:wrap;gap:5px}
.whale-mate__menu .whale-mate__tab{padding:4px 10px;border-radius:999px;font-size:12px;background:rgba(120,140,220,.1);display:inline-flex;gap:4px;align-items:baseline}
.whale-mate__tab small{font-size:10px;opacity:.6}
.whale-mate__menu .whale-mate__tab.is-on{background:#5b6fd6;color:#fff}
.whale-mate__menu .whale-mate__tab.is-on:hover{background:#4e62c8}
.whale-mate__motion-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;overflow:auto;max-height:min(340px,calc(100vh - 230px));min-height:60px;overscroll-behavior:contain;padding:1px}
.whale-mate__menu .whale-mate__tile{display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:11px;border:1px solid rgba(98,113,190,.16);background:rgba(120,140,220,.04);min-width:0;box-sizing:border-box}
.whale-mate__menu .whale-mate__tile:hover{background:#eef1fc;border-color:rgba(98,113,190,.35)}
.whale-mate__menu .whale-mate__tile.is-on{background:#e6eafd;border-color:#5b6fd6;box-shadow:inset 0 0 0 1px #5b6fd6}
.whale-mate__tile-icon{font-size:19px;line-height:1;flex:none}
.whale-mate__tile-text{display:flex;flex-direction:column;min-width:0}
.whale-mate__tile-label{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.whale-mate__tile-meta{font-size:11px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.whale-mate__lib-empty{grid-column:1/-1;margin:14px 0;text-align:center;font-size:13px;opacity:.6}
.whale-mate__lib-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 2px 0}
.whale-mate__lib-now{font-size:12px;opacity:.75;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.whale-mate__menu .whale-mate__lib-stop{flex:none;padding:5px 12px;border-radius:999px;font-size:12px;background:rgba(214,91,91,.12);color:#c04848}
.whale-mate__lib-more{font-size:12px;opacity:.75}
.whale-mate__lib-more summary{cursor:pointer;padding:2px}
.whale-mate__lib-pending{max-height:120px;overflow:auto;display:flex;flex-direction:column;gap:2px;padding:4px 2px;opacity:.75}
.whale-mate__menu button:disabled{opacity:.45;cursor:default}
.whale-mate__menu button:focus-visible{outline:2px solid #657de0}
@media (prefers-color-scheme:dark){.whale-mate__seg path{fill:rgba(35,40,56,.7);stroke:rgba(160,172,230,.25)}.whale-mate__seg text{fill:#e8ebf7;stroke:rgba(20,24,36,.7)}.whale-mate__seg.is-mode path{fill:rgba(44,51,82,.78)}.whale-mate__seg.is-mode text{fill:#b9c4ff}.whale-mate__bubble,.whale-mate__menu{background:#232838;color:#e8ebf7;border-color:rgba(160,172,230,.22)}
  .whale-mate__menu button:hover{background:#30374d}
  .whale-mate__menu .whale-mate__tile:hover{background:#30374d}
  .whale-mate__menu .whale-mate__tile.is-on{background:#343d63;border-color:#8295f0;box-shadow:inset 0 0 0 1px #8295f0}
  .whale-mate__menu .whale-mate__tab.is-on{background:#6c7fe6}
  .whale-mate__menu .whale-mate__lib-stop{color:#f08a8a}}
@keyframes whale-mate-pop{from{opacity:0;transform:translateY(4px) scale(.97)}}
@keyframes whale-mate-dot{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-4px)}}
`
