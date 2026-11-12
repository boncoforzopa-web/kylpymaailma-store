// Kylpymaailma admin panel (/admin). Server-rendered, no build step. Password = ADMIN_PASSWORD.
'use strict';
const crypto = require('crypto');
const D = require('./data');
const PC = require('./prochart');
const stock = require('./stock');
const T = require('./emails');
const { send, OWNER, legalAttachment } = require('./mail');
const { parseCookies } = require('./cart');
const checkout = require('./checkout');
const telegram = require('./telegram');
const SS = require('./stripeslots');
const tgpanel = require('./tgpanel');

const COOKIE = 'tw_admin';
const TZ = 'Europe/Helsinki';
const tokenFor = () => crypto.createHmac('sha256', require('./secret')).update(`admin:${process.env.ADMIN_PASSWORD || ''}`).digest('base64url');
const authed = (req) => !!process.env.ADMIN_PASSWORD && parseCookies(req.headers.cookie)[COOKIE] === tokenFor();
const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (c) => `€${(Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n) => Number(n || 0).toLocaleString('en-US');
const pct = (n) => `${(Number(n) || 0).toFixed(1)}%`;
const dt = (d) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
const dd = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '–');
const tm = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '–');
const ago = (d) => { if (!d) return '–'; const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000); if (s < 45) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`; };
const CARRIERS = {
  Posti: (t) => `https://www.posti.fi/seuranta#/lahetys/${encodeURIComponent(t)}`,
  Matkahuolto: (t) => `https://www.matkahuolto.fi/seuranta/tilanne/?package_code=${encodeURIComponent(t)}`,
  PostNord: (t) => `https://tracking.postnord.com/fi/?id=${encodeURIComponent(t)}`,
  DHL: (t) => `https://www.dhl.com/fi-fi/home/tracking.html?tracking-id=${encodeURIComponent(t)}`,
  DPD: (t) => `https://www.dpd.com/tracking?parcelNumber=${encodeURIComponent(t)}`,
  GLS: (t) => `https://gls-group.com/FI/fi/seuraa-lahetysta?match=${encodeURIComponent(t)}`,
  UPS: (t) => `https://www.ups.com/track?loc=fi_FI&tracknum=${encodeURIComponent(t)}`,
};
const STATUS = { pending: ['Awaiting payment', 'pending'], paid: ['To ship', 'paid'], shipped: ['Shipped', 'shipped'], refunded: ['Refunded', 'refunded'], cancelled: ['Cancelled', 'cancelled'] };
const pill = (s) => { const [l, c] = STATUS[s] || [s, 'pending']; return `<span class="pill ${c}">${l}</span>`; };
const NAV = [
  ['/admin', 'Dashboard', 'M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z'],
  ['/admin/live', 'Live', 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z'],
  ['/admin/orders', 'Orders', 'M4 4h16l-2 13H6zM8 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
  ['/admin/orders/abandoned', 'Abandoned carts', 'M3 5h3l2 10h10l2-7H8M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
  ['/admin/products', 'Products & stock', 'M12 2 2 7l10 5 10-5zm-10 10 10 5 10-5M2 17l10 5 10-5'],
  ['/admin/customers', 'Customers', 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zm-12 9a8 8 0 0 1 16 0z'],
  ['/admin/messages', 'Messages', 'M3 5h18v12H8l-5 4z'],
  ['/admin/newsletter', 'Newsletter', 'M3 6h18v12H3zm0 0 9 7 9-7'],
  ['/admin/analytics', 'Analytics', 'M4 20V10m6 10V4m6 16v-8m4 8H2'],
  ['/admin/google', 'Google Ads & Merchant', 'M12 11v2h5a5 5 0 1 1-1.5-3.5l1.5-1.5A7 7 0 1 0 19 13v-2z'],
  ['/admin/stripe', 'Stripe & payouts', 'M3 6h18v12H3zm0 4h18M7 14h4'],
  ['/admin/settings', 'Settings', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8 4-2 1 .5 2-2 2-2-.5-1 2h-3l-1-2-2 .5-2-2 .5-2-2-1v-3l2-1-.5-2 2-2 2 .5 1-2h3l1 2 2-.5 2 2-.5 2 2 1z'],
];
const ICON = (d, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

const CSS = `
:root{color-scheme:dark;--ink:#0B0F1A;--ink2:#1A2130;--gold:#FFD60A;--gold2:#FFB800;--bg:#07090F;--card:#10141F;--card2:#151A28;--line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.055);--muted:#8A93A8;--text:#E9ECF4;--green:#34D399;--green-bg:rgba(52,211,153,.13);--red:#F87171;--red-bg:rgba(248,113,113,.13);--amber:#FBBF24;--amber-bg:rgba(251,191,36,.13);--blue:#7CB4FF;--blue-bg:rgba(96,165,250,.14);--violet:#B79CFF;--r:18px;--glow:0 0 0 1px rgba(255,214,10,.22),0 8px 30px -8px rgba(255,214,10,.28)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;background:var(--bg)}body{margin:0;font:14.5px/1.5 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:radial-gradient(900px 520px at 88% -8%,rgba(255,214,10,.10),transparent 60%),radial-gradient(760px 520px at 12% 108%,rgba(124,92,255,.10),transparent 60%),var(--bg);background-attachment:fixed;color:var(--text);-webkit-font-smoothing:antialiased}a{color:inherit}
::selection{background:rgba(255,214,10,.35)}::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:999px;border:2px solid transparent;background-clip:padding-box}::-webkit-scrollbar-thumb:hover{background:rgba(255,214,10,.45);border:2px solid transparent;background-clip:padding-box}::-webkit-scrollbar-track{background:transparent}
.app{display:grid;grid-template-columns:252px 1fr;min-height:100vh}
aside{background:linear-gradient(180deg,rgba(18,22,34,.92),rgba(9,11,18,.92));backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-right:1px solid var(--line);color:#B9C0D0;padding:20px 14px;position:sticky;top:0;height:100vh;overflow:auto;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:12px;padding:6px 10px 18px;border-bottom:1px solid var(--line);margin-bottom:12px}.brand .mark{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#FFE55C,#FFB800);color:var(--ink);display:grid;place-items:center;font-weight:900;letter-spacing:-.5px;box-shadow:0 6px 22px -4px rgba(255,200,0,.55),inset 0 1px 0 rgba(255,255,255,.5)}.brand b{display:block;font-size:14px;letter-spacing:1.6px;background:linear-gradient(90deg,#fff,#FFE55C);-webkit-background-clip:text;background-clip:text;color:transparent}.brand small{display:block;color:#6F778B;font-size:10.5px;letter-spacing:1.4px;margin-top:1px}
nav a{display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:12px;color:#B9C0D0;text-decoration:none;font-size:13.5px;font-weight:500;margin:2px 0;transition:background .15s,color .15s,transform .15s;position:relative}nav a svg{opacity:.7;flex:none;transition:opacity .15s}nav a:hover{background:rgba(255,255,255,.06);color:#fff;transform:translateX(2px)}nav a:hover svg{opacity:1}nav a.on{background:linear-gradient(90deg,rgba(255,214,10,.2),rgba(255,214,10,.04));color:#FFE55C;font-weight:700;box-shadow:inset 0 0 0 1px rgba(255,214,10,.25)}nav a.on:before{content:"";position:absolute;left:-14px;top:8px;bottom:8px;width:4px;border-radius:0 4px 4px 0;background:var(--gold);box-shadow:0 0 14px rgba(255,214,10,.9)}nav a.on svg{opacity:1}
nav a .dot{margin-left:auto;width:8px;height:8px;border-radius:50%;background:#34D399;box-shadow:0 0 0 3px rgba(52,211,153,.22),0 0 12px rgba(52,211,153,.9);animation:pulse 1.6s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
.foot{margin-top:auto;padding:12px 10px 0;font-size:12px;color:#6F778B;border-top:1px solid var(--line)}.foot a{color:#B9C0D0;text-decoration:none}.foot a:hover{color:var(--gold)}
main{padding:26px 32px 48px;min-width:0;animation:in .35s ease-out}@keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){main{animation:none}nav a:hover{transform:none}.card:hover{transform:none}}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px;flex-wrap:wrap}h1{margin:0;font-size:26px;letter-spacing:-.5px;font-weight:800;background:linear-gradient(90deg,#fff 30%,#FFE55C);-webkit-background-clip:text;background-clip:text;color:transparent;width:fit-content}.sub{color:var(--muted);margin:3px 0 0;font-size:13.5px}h2{font-size:12px;margin:0 0 12px;text-transform:uppercase;letter-spacing:1.1px;color:var(--muted);font-weight:700;display:flex;align-items:center;justify-content:space-between;gap:10px}h2 a{font-weight:600;text-transform:none;letter-spacing:0;font-size:12.5px;color:var(--gold);text-decoration:none}h2 a:hover{text-decoration:underline}
.card{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.02));border:1px solid var(--line);border-radius:var(--r);padding:18px 20px;margin-bottom:16px;box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -24px rgba(0,0,0,.8);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.card.tight{padding:0;overflow:hidden}.card.tight h2{padding:14px 18px 0}.card.tight table{margin-top:8px}
.grid{display:grid;gap:14px}.g2{grid-template-columns:1fr 1fr}.g3{grid-template-columns:repeat(3,1fr)}.g4{grid-template-columns:repeat(4,1fr)}.g5{grid-template-columns:repeat(5,1fr)}.g23{grid-template-columns:2fr 1fr}.g32{grid-template-columns:3fr 2fr}
.kpi{padding:16px 18px;position:relative;overflow:hidden;transition:transform .18s,box-shadow .18s,border-color .18s}.kpi:before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,var(--k,#FFD60A),transparent 75%)}.kpi:after{content:"";position:absolute;right:-40px;top:-40px;width:130px;height:130px;border-radius:50%;background:radial-gradient(closest-side,var(--k,#FFD60A),transparent);opacity:.13;pointer-events:none}.kpi:hover{transform:translateY(-2px);border-color:rgba(255,214,10,.3);box-shadow:var(--glow)}.grid>.kpi:nth-child(4n+2){--k:#34D399}.grid>.kpi:nth-child(4n+3){--k:#7CB4FF}.grid>.kpi:nth-child(4n+4){--k:#B79CFF}.kpi .l{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);font-weight:700}.kpi .v{font-size:28px;font-weight:800;letter-spacing:-.7px;margin-top:6px;line-height:1.1;color:#fff;font-variant-numeric:tabular-nums}.kpi .d{font-size:12.5px;color:var(--muted);margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.kpi .d b{color:var(--text)}.kpi svg.spark{display:block;width:100%;height:26px;margin-top:10px;filter:drop-shadow(0 0 5px rgba(255,214,10,.55))}
.delta{display:inline-flex;align-items:center;gap:3px;font-size:11.5px;font-weight:700;padding:1px 7px;border-radius:999px}.delta.up{background:var(--green-bg);color:var(--green)}.delta.down{background:var(--red-bg);color:var(--red)}.delta.flat{background:var(--line2);color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line2);vertical-align:middle}th{font-size:10.5px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-weight:700;white-space:nowrap}tr:last-child td{border-bottom:0}tbody tr{transition:background .12s}tbody tr:hover td{background:rgba(255,214,10,.045)}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}td.num{font-variant-numeric:tabular-nums}td img{width:38px;height:38px;object-fit:contain;border-radius:9px;border:1px solid var(--line);background:#fff;vertical-align:middle}td a{text-decoration:none}td a:hover{color:var(--gold)}.empty{color:var(--muted);padding:18px 12px;text-align:center}
.pill{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap;line-height:1.4;box-shadow:inset 0 0 0 1px currentColor;box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 28%,transparent)}.paid{background:var(--amber-bg);color:var(--amber)}.shipped{background:var(--green-bg);color:var(--green)}.refunded{background:var(--red-bg);color:var(--red)}.pending,.cancelled{background:var(--line2);color:var(--muted)}.ok{background:var(--green-bg);color:var(--green)}.warn{background:var(--red-bg);color:var(--red)}.info{background:var(--blue-bg);color:var(--blue)}.gold{background:rgba(255,214,10,.14);color:#FFE55C}
input,select,textarea{font:inherit;padding:9px 12px;border:1px solid rgba(255,255,255,.14);border-radius:11px;width:100%;background:rgba(0,0,0,.35);color:var(--text)}input::placeholder,textarea::placeholder{color:#5F6779}input:focus,select:focus,textarea:focus{outline:0;border-color:var(--gold);box-shadow:0 0 0 3px rgba(255,214,10,.2)}textarea{min-height:80px}label{display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px;letter-spacing:.3px}select option{background:#151A28;color:var(--text)}
.btn{font:inherit;font-weight:700;padding:10px 16px;border:0;border-radius:999px;background:linear-gradient(135deg,#FFE55C,#FFB800);color:var(--ink);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;font-size:13.5px;white-space:nowrap;box-shadow:0 6px 20px -6px rgba(255,200,0,.6),inset 0 1px 0 rgba(255,255,255,.45);transition:transform .12s,box-shadow .12s,filter .12s}.btn:hover{filter:brightness(1.06);transform:translateY(-1px)}.btn:active{transform:none}.btn.dark,.btn.ghost{background:rgba(255,255,255,.07);color:var(--text);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}.btn.dark:hover,.btn.ghost:hover{background:rgba(255,255,255,.12);box-shadow:inset 0 0 0 1px rgba(255,214,10,.45)}.btn.danger{background:var(--red-bg);color:var(--red);box-shadow:inset 0 0 0 1px rgba(248,113,113,.3)}.btn.sm{padding:6px 12px;font-size:12.5px}
.row{display:grid;gap:12px;align-items:end}.muted{color:var(--muted);font-size:13px}.flash{background:var(--green-bg);color:var(--green);padding:11px 16px;border-radius:12px;margin-bottom:16px;font-weight:600;font-size:13.5px;box-shadow:inset 0 0 0 1px rgba(52,211,153,.3)}.flash.err{background:var(--red-bg);color:var(--red);box-shadow:inset 0 0 0 1px rgba(248,113,113,.3)}
.tl{list-style:none;margin:0;padding:0}.tl li{display:grid;grid-template-columns:140px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid var(--line2);font-size:13px}.tl li span{color:var(--muted);font-variant-numeric:tabular-nums}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}.tabs a{padding:6px 13px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid var(--line);text-decoration:none;font-size:12.5px;font-weight:600;color:var(--muted);transition:.12s}.tabs a:hover{color:var(--text);border-color:rgba(255,214,10,.35)}.tabs a.on{background:linear-gradient(135deg,#FFE55C,#FFB800);color:var(--ink);border-color:transparent;box-shadow:0 6px 18px -6px rgba(255,200,0,.6)}.tabs a b{color:inherit;opacity:.7;font-weight:600;margin-left:4px}
.search{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}.search input{max-width:360px}.search select{max-width:200px}
.chart{width:100%;height:auto;display:block}.chart .bar{fill:var(--gold)}.chart .bar:hover{fill:#FFE55C}.chart .bar2{fill:#fff;opacity:.12}.chart text{font-size:10px;fill:var(--muted)}.chart .grid{stroke:var(--line2)}.chart .line{fill:none;stroke:#7CB4FF;stroke-width:1.6}.chart .area{fill:url(#ga)}
.legend{display:flex;gap:16px;font-size:12px;color:var(--muted);margin-top:8px;flex-wrap:wrap}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.feed{list-style:none;margin:0;padding:0}.feed li{display:grid;grid-template-columns:30px 1fr auto;gap:10px;align-items:start;padding:9px 0;border-bottom:1px solid var(--line2);font-size:13px}.feed li:last-child{border-bottom:0}.feed .ic{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-size:13px;background:var(--line2)}.feed .ic.order{background:var(--green-bg)}.feed .ic.checkout{background:var(--amber-bg)}.feed .ic.ship{background:var(--blue-bg)}.feed .ic.refund,.feed .ic.cancel,.feed .ic.withdrawal{background:var(--red-bg)}.feed .ic.message,.feed .ic.newsletter,.feed .ic.waitlist{background:rgba(183,156,255,.16)}.feed .who{color:var(--muted);font-size:12px}.feed .t{color:var(--muted);font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}.feed a{text-decoration:none;font-weight:600}.feed a:hover{color:var(--gold)}
.bars-h{display:grid;gap:9px}.bars-h div{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;font-size:13px}.bars-h>div>div{display:block;min-width:0}.bars-h i{display:block;height:6px;border-radius:3px;background:linear-gradient(90deg,#FFB800,#FFE55C);margin-top:4px;box-shadow:0 0 10px rgba(255,214,10,.45)}.bars-h b{font-variant-numeric:tabular-nums;font-weight:600}
.live-badge{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:var(--green);background:var(--green-bg);padding:4px 10px;border-radius:999px;box-shadow:inset 0 0 0 1px rgba(52,211,153,.3)}.live-badge i{width:7px;height:7px;border-radius:50%;background:#34D399;box-shadow:0 0 10px #34D399;animation:pulse 1.4s infinite}
.big{font-size:48px;font-weight:900;letter-spacing:-1.5px;line-height:1;background:linear-gradient(180deg,#fff,#FFE55C);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 18px rgba(255,214,10,.3))}.stat{display:flex;flex-direction:column;gap:2px}.stat .l{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;font-weight:700}
code{background:rgba(255,255,255,.08);padding:2px 7px;border-radius:6px;font-size:12.5px;color:#FFE55C}details summary{cursor:pointer}hr{border:0;border-top:1px solid var(--line)}
.login{max-width:400px;margin:14vh auto}.login .mark{width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,#FFE55C,#FFB800);color:var(--ink);display:grid;place-items:center;font-weight:900;font-size:19px;margin-bottom:14px;box-shadow:0 10px 30px -6px rgba(255,200,0,.6)}
.leaflet-container{background:#0B0F1A!important}.city-l{white-space:nowrap;font-size:10.5px;font-weight:600;color:rgba(255,255,255,.38);letter-spacing:.3px;display:flex!important;align-items:center;gap:5px;width:auto!important;height:auto!important;transform-origin:left;margin-top:-7px!important;margin-left:-2px!important}.city-l i{width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.35);flex:none}.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#151A28!important;color:var(--text)!important;box-shadow:0 12px 40px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.1)!important}.leaflet-popup-content a{color:var(--gold)!important}.leaflet-container a.leaflet-popup-close-button{color:var(--muted)!important}.leaflet-bar a{background:#151A28!important;color:var(--text)!important;border-color:rgba(255,255,255,.1)!important}.leaflet-bar a:hover{background:#1D2436!important}.leaflet-control-attribution{background:rgba(7,9,15,.7)!important;color:#6F778B!important}.leaflet-control-attribution a{color:#8A93A8!important}
@media(max-width:980px){.g3,.g4,.g5{grid-template-columns:1fr 1fr}.card.tight table{display:block;overflow-x:auto}.g23,.g32{grid-template-columns:1fr}}
@media(max-width:860px){.app{grid-template-columns:1fr}aside{position:static;height:auto;padding:12px;border-right:0;border-bottom:1px solid var(--line)}nav{display:flex;flex-wrap:wrap;gap:3px}nav a{padding:6px 10px;font-size:12.5px}nav a.on:before{display:none}nav a:hover{transform:none}.foot{display:none}main{padding:16px 14px 40px}.g2{grid-template-columns:1fr}.hide{display:none}.tl li{grid-template-columns:1fr}.kpi .v{font-size:22px}}
`;

function layout(res, { title, body, status = 200, path = '/admin', flash = '' }) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const on = (h) => path === h || (h !== '/admin' && path.startsWith(h) && !(h === '/admin/orders' && path.startsWith('/admin/orders/abandoned')));
  const nav = NAV.map(([h, l, d]) => `<a href="${h}" class="${on(h) ? 'on' : ''}">${ICON(d)}${l}${h === '/admin/live' ? '<span class="dot"></span>' : ''}</a>`).join('');
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Kylpymaailma Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="app"><aside><div class="brand"><div class="mark">KM</div><div><b>KYLPYMAAILMA</b><small>STORE ADMIN</small></div></div><nav>${nav}</nav><div class="foot"><a href="/" target="_blank">Open shop ↗</a> &nbsp;·&nbsp; <a href="/admin/logout">Sign out</a><div style="margin-top:6px;opacity:.7">${new Date().toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} Helsinki</div></div></aside><main>${flash ? `<div class="flash${flash.startsWith('!') ? ' err' : ''}">${esc(flash.replace(/^!/, ''))}</div>` : ''}${body}</main></div></body></html>`);
}
const redirect = (res, to) => { res.statusCode = 303; res.setHeader('Location', to); res.setHeader('Cache-Control', 'no-store'); res.end(); };
const loginForm = (err = '') => `<div class="card login"><div class="mark">KM</div><h1>Sign in</h1><p class="sub">Kylpymaailma store admin</p>${err ? `<p style="color:var(--red);font-weight:600">${err}</p>` : ''}<form method="post" action="/admin/login" style="margin-top:14px"><label>Password</label><input type="password" name="password" autofocus autocomplete="current-password"><div style="height:12px"></div><button class="btn" type="submit">Sign in →</button></form></div>`;
const thumb = (p) => { const i = p && p.featured_image; return i && i.__img && i.__img.base ? `/images/${i.__img.base}-${i.__img.widths[0]}.webp` : ''; };
const liveStock = (p) => p.variants.reduce((a, v) => a + (v.inventory_quantity || 0), 0);
const head = (title, sub, right = '') => `<div class="head"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${right ? `<div>${right}</div>` : ''}</div>`;
const empty = (t, cols = 1) => `<tr><td colspan="${cols}" class="empty">${t}</td></tr>`;

// ------------------------------------------------------------------ small viz helpers
function delta(cur, prev) {
  if (!prev && !cur) return '<span class="delta flat">–</span>';
  if (!prev) return '<span class="delta up">new</span>';
  const d = ((cur - prev) / prev) * 100;
  const c = d > 0.5 ? 'up' : d < -0.5 ? 'down' : 'flat';
  return `<span class="delta ${c}">${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${Math.abs(d).toFixed(0)}%</span>`;
}
function spark(values, w = 200, h = 24) {
  const max = Math.max(1, ...values); const n = values.length;
  const pts = values.map((v, i) => `${(i / Math.max(1, n - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#FFD60A" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
// 30-day bar chart: bars = money, dots/line = count
function barChart(rows, { fmt = money, label = 'day' } = {}) {
  const W = 760, H = 180, padL = 60, padB = 24, padT = 10; const n = rows.length;
  const max = Math.max(1, ...rows.map((r) => r.v)); const max2 = Math.max(1, ...rows.map((r) => r.n || 0));
  const bw = (W - padL) / n; const y = (v) => padT + (H - padT - padB) * (1 - v / max); const y2 = (v) => padT + (H - padT - padB) * (1 - v / max2);
  const grid = [0, 0.5, 1].map((f) => `<line class="grid" x1="${padL}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${padL - 6}" y="${y(max * f) + 3}" text-anchor="end">${fmt(max * f).replace('.00', '')}</text>`).join('');
  const bars = rows.map((r, i) => `<rect class="bar" x="${padL + i * bw + bw * 0.18}" y="${y(r.v)}" width="${bw * 0.64}" height="${Math.max(0, H - padB - y(r.v))}" rx="2"><title>${r.label}: ${fmt(r.v)}${r.n !== undefined ? ` · ${r.n} ${label === 'day' ? 'orders' : ''}` : ''}</title></rect>`).join('');
  const line = rows.some((r) => r.n) ? `<polyline class="line" points="${rows.map((r, i) => `${padL + i * bw + bw / 2},${y2(r.n || 0)}`).join(' ')}"/>` : '';
  const labels = rows.map((r, i) => (i % Math.ceil(n / 10) === 0 ? `<text x="${padL + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${r.short}</text>` : '')).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${grid}${bars}${line}${labels}</svg>`;
}
function hbars(rows, total) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return `<div class="bars-h">${rows.map(([k, n]) => `<div><div><span>${esc(k)}</span><i style="width:${Math.round((n / max) * 100)}%"></i></div><b>${num(n)}${total ? `<span class="muted"> · ${pct((n / total) * 100)}</span>` : ''}</b></div>`).join('') || '<p class="muted">No data yet.</p>'}</div>`;
}
const FEED_ICON = { order: '🛒', checkout: '💳', ship: '📦', refund: '↩', cancel: '✕', message: '✉', withdrawal: '⚠', newsletter: '✦', waitlist: '⏳', stock: '▣', note: '✎', reminder: '🔔', restock: '▣' };
function feed(items, { limit = 30 } = {}) {
  return `<ul class="feed">${items.slice(0, limit).map((e) => `<li><div class="ic ${esc(e.type)}">${FEED_ICON[e.type] || '•'}</div><div>${e.href ? `<a href="${esc(e.href)}">${esc(e.text)}</a>` : esc(e.text)}${e.who ? `<div class="who">${esc(e.who)}${e.city ? ` · ${esc(e.city)}` : ''}</div>` : ''}</div><div class="t" title="${dt(e.at)}">${ago(e.at)}</div></li>`).join('') || '<li class="empty">Nothing yet — activity appears here as it happens.</li>'}</ul>`;
}

// ------------------------------------------------------------------ data shaping
async function orderStats() {
  const all = (await stock.listOrders(1000)).filter((o) => o.status !== 'pending');
  const good = (o) => o.status !== 'refunded' && o.status !== 'cancelled';
  const t = (o) => new Date(o.paidAt || o.created).getTime();
  const now = Date.now();
  const within = (a, b) => all.filter((o) => now - t(o) >= a * 864e5 && now - t(o) < b * 864e5);
  const rev = (list) => list.filter(good).reduce((a, o) => a + o.total, 0);
  const todayKey = stock.day(); const yKey = stock.day(new Date(now - 864e5));
  const today = all.filter((o) => stock.day(o.paidAt || o.created) === todayKey);
  const yesterday = all.filter((o) => stock.day(o.paidAt || o.created) === yKey);
  const d7 = within(0, 7), p7 = within(7, 14), d30 = within(0, 30), p30 = within(30, 60);
  const days = []; for (let i = 29; i >= 0; i--) { const d = new Date(now - i * 864e5); const k = stock.day(d); const list = all.filter((o) => good(o) && stock.day(o.paidAt || o.created) === k); days.push({ key: k, label: dd(d), short: d.toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short' }), v: list.reduce((a, o) => a + o.total, 0), n: list.length }); }
  return { all, good, rev, today, yesterday, d7, p7, d30, p30, days, open: all.filter((o) => o.status === 'paid') };
}

// ------------------------------------------------------------------ pages
async function dashboard() {
  const S = await orderStats();
  const [visits, activity, carts, live] = await Promise.all([stock.visitStats(60), stock.listActivity(12), stock.listCarts(), stock.liveStats(5)]);
  const v30 = visits.slice(-30), vp30 = visits.slice(0, 30);
  const views = (l) => l.reduce((a, v) => a + (v.views || 0), 0);
  const todayViews = views(visits.slice(-1)), yViews = views(visits.slice(-2, -1));
  const liveNow = live.slice(-3).reduce((a, m) => a + (m.views || 0), 0);
  const conv = views(v30) ? (S.d30.filter(S.good).length / views(v30)) * 100 : 0;
  const convP = views(vp30) ? (S.p30.filter(S.good).length / views(vp30)) * 100 : 0;
  const aov = (l) => { const g = l.filter(S.good); return g.length ? S.rev(g) / g.length : 0; };
  const low = D.ACTIVE.filter((p) => p.variants.some((v) => v.inventory_management && v.inventory_policy !== 'continue' && v.inventory_quantity <= 3)).sort((a, b) => liveStock(a) - liveStock(b)).slice(0, 7);
  const sold = {}; for (const o of S.d30.filter(S.good)) for (const l of o.lines) { sold[l.handle] = sold[l.handle] || { n: 0, rev: 0 }; sold[l.handle].n += l.quantity; sold[l.handle].rev += l.price * l.quantity; }
  const top = Object.entries(sold).sort((a, b) => b[1].rev - a[1].rev).slice(0, 7);
  const pay = {}; for (const o of S.d30.filter(S.good)) pay[o.paymentLabel || 'Other'] = (pay[o.paymentLabel || 'Other'] || 0) + 1;
  const refs = {}; for (const d of v30) for (const [k, n] of Object.entries(d)) if (k.startsWith('ref:')) refs[k.slice(4)] = (refs[k.slice(4)] || 0) + n;
  const statusCount = {}; for (const o of S.d30) statusCount[o.status] = (statusCount[o.status] || 0) + 1;
  const env = { stripe: !!checkout.KEYS.sk, pk: !!checkout.KEYS.pk, resend: !!process.env.RESEND_API_KEY, redis: stock.enabled() };
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => ({ stripe: 'Stripe secret key', pk: 'Stripe publishable key', resend: 'Resend (e-mails)', redis: 'Database' })[k]);
  const kpi = (l, v, d, sp) => `<div class="card kpi${sp ? ' has-spark' : ''}"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div>${sp ? spark(sp) : ''}</div>`;
  return `${head('Dashboard', new Date().toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), `<a class="live-badge" href="/admin/live" style="text-decoration:none;padding:7px 12px"><i></i> Live view</a> &nbsp;<a class="btn sm" href="/admin/orders?status=paid">${S.open.length} to ship →</a> &nbsp;<a class="btn ghost sm" href="/admin" id="dash-refresh">↻ Refresh</a> <label class="muted" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;margin-left:6px;cursor:pointer"><input type="checkbox" id="dash-auto" style="width:auto;margin:0"> auto every 60 s</label><script>(function(){var c=document.getElementById('dash-auto');try{c.checked=localStorage.getItem('tw-dash-auto')==='1'}catch(e){}var t=null;function arm(){if(t)clearInterval(t);t=null;if(c.checked)t=setInterval(function(){if(!document.hidden)location.replace('/admin')},60000)}c.addEventListener('change',function(){try{localStorage.setItem('tw-dash-auto',c.checked?'1':'0')}catch(e){}arm()});arm()})();</script>`)}
${missing.length ? `<div class="flash err">Not configured yet: ${missing.join(', ')} → <a href="/admin/settings">Settings</a></div>` : ''}
<div class="grid g4">
${kpi('Today', money(S.rev(S.today)), `${S.today.length} order${S.today.length === 1 ? '' : 's'} ${delta(S.rev(S.today), S.rev(S.yesterday))} <span>vs yesterday</span>`)}
${kpi('Last 7 days', money(S.rev(S.d7)), `${S.d7.length} orders ${delta(S.rev(S.d7), S.rev(S.p7))} <span>vs prev. 7d</span>`, S.days.slice(-14).map((d) => d.v))}
${kpi('Last 30 days', money(S.rev(S.d30)), `${S.d30.length} orders · AOV ${money(aov(S.d30))} ${delta(S.rev(S.d30), S.rev(S.p30))}`, S.days.map((d) => d.v))}
${kpi('Visitors today', num(todayViews), `${delta(todayViews, yViews)} <span>vs yesterday</span> · <b style="color:var(--green)">${liveNow} live</b>`, visits.slice(-14).map((d) => d.views || 0))}
</div>
<div class="grid g4">
${kpi('Conversion rate', pct(conv), `orders ÷ page views, 30d ${delta(conv, convP)}`)}
${kpi('To ship', num(S.open.length), `<a href="/admin/orders?status=paid">paid, not yet shipped →</a>`)}
${kpi('Abandoned carts', num(carts.length), `${money(carts.reduce((a, c) => a + c.total, 0))} in carts · <a href="/admin/orders/abandoned">recover →</a>`)}
${kpi('Page views, 30d', num(views(v30)), `${delta(views(v30), views(vp30))} <span>vs prev. 30d</span>`)}
</div>
<div class="card"><h2>Performance <span class="muted" style="font-size:12px;font-weight:600">click a tile to switch the chart · hover a bar for details</span></h2>${PC.render('pc-dash', PC.series(stock, S, visits), { metric: 'r' })}</div>
<div class="grid g3">
<div class="card tight"><h2>Recent orders <a href="/admin/orders">All →</a></h2><table>${S.all.slice(0, 7).map((o) => `<tr><td><a href="/admin/orders/${encodeURIComponent(o.id)}"><b>${esc(o.number)}</b></a><div class="muted" style="font-size:12px">${ago(o.paidAt || o.created)}</div></td><td>${esc(o.name || o.email)}<div class="muted" style="font-size:12px">${esc(o.address && o.address.city)}</div></td><td class="r">${money(o.total)}</td><td>${pill(o.status)}</td></tr>`).join('') || empty('No orders yet.', 4)}</table></div>
<div class="card tight"><h2>Top products · 30d <a href="/admin/products?sort=sold">All →</a></h2><table>${top.map(([h, s]) => { const p = D.productByHandle(h); return `<tr><td><img src="${thumb(p)}" alt=""></td><td>${p ? `<a href="/admin/products/${h}">${esc(p.title)}</a>` : esc(h)}<div class="muted" style="font-size:12px">${s.n} sold</div></td><td class="r"><b>${money(s.rev)}</b></td></tr>`; }).join('') || empty('No sales in the last 30 days.', 3)}</table></div>
<div class="card"><h2>Activity <a href="/admin/live">Live view →</a></h2>${feed(activity, { limit: 9 })}</div>
</div>
<div class="grid g4">
<div class="card tight"><h2>Low stock <a href="/admin/products">Manage →</a></h2><table>${low.map((p) => `<tr><td><img src="${thumb(p)}" alt=""></td><td><a href="/admin/products/${p.handle}">${esc(p.title)}</a></td><td class="r"><b style="color:${liveStock(p) === 0 ? 'var(--red)' : 'var(--amber)'}">${liveStock(p)}</b></td></tr>`).join('') || empty('Everything is well stocked.', 3)}</table></div>
<div class="card"><h2>Payment methods · 30d</h2>${hbars(Object.entries(pay).sort((a, b) => b[1] - a[1]), S.d30.filter(S.good).length)}</div>
<div class="card"><h2>Traffic sources · 30d</h2>${hbars(Object.entries(refs).sort((a, b) => b[1] - a[1]).slice(0, 7), views(v30))}</div>
<div class="card"><h2>Order status · 30d</h2>${hbars(Object.entries(statusCount).map(([k, n]) => [(STATUS[k] || [k])[0], n]).sort((a, b) => b[1] - a[1]), S.d30.length)}</div>
</div>`;
}

const FLAG = (cc) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65)) : '🌐');
const COUNTRY = { FI: 'Finland', EE: 'Estonia', NO: 'Norway', DE: 'Germany', AT: 'Austria', CH: 'Switzerland', NL: 'Netherlands', FR: 'France', IT: 'Italy', ES: 'Spain', PL: 'Poland', BE: 'Belgium', DK: 'Denmark', SE: 'Sweden', GB: 'United Kingdom', US: 'United States', CZ: 'Czechia', LU: 'Luxembourg', MA: 'Morocco', TR: 'Türkiye' };
function prettyPath(u) {
  if (!u || u === '/') return 'Home';
  let m;
  if ((m = /^\/products\/([^/?#]+)/.exec(u))) { const p = D.productByHandle(m[1]); return p ? p.title : `Product: ${m[1]}`; }
  if ((m = /^\/collections\/([^/?#]+)/.exec(u))) return m[1] === 'all' ? 'All products' : `Collection: ${m[1].replace(/-/g, ' ')}`;
  if (/^\/collections/.test(u)) return 'Collections';
  if (/^\/cart/.test(u)) return '🛒 Cart';
  if (/^\/checkout\/danke/.test(u)) return '✅ Thank-you page';
  if (/^\/checkout/.test(u)) return '💳 Checkout';
  if (/^\/search/.test(u)) return 'Search';
  if (/^\/tilaus/.test(u)) return 'Order status';
  if ((m = /^\/pages\/([^/?#]+)/.exec(u))) return `Page: ${m[1].replace(/-/g, ' ')}`;
  return u;
}
const dur = (ms) => { const m = Math.round(ms / 60000); if (m < 1) return '< 1 min'; if (m < 60) return `${m} min`; return `${Math.floor(m / 60)} h ${m % 60} min`; };
const sessState = (s) => { const a = Date.now() - s.last; return a < 1 * 60000 ? ['active', '#22C55E', 'active now'] : a < 2 * 60000 ? ['idle', '#F59E0B', 'idle'] : ['away', '#9CA3AF', 'inactive']; };
function sessionRow(s, { detailLink = true } = {}) {
  const [st, color, stLabel] = sessState(s);
  const who = s.order ? `<b>${esc(s.name || s.email)}</b> <span class="pill ok">order ${esc(s.order)}</span>` : s.email ? `<b>${esc(s.name || s.email)}</b> ${s.checkout ? `<span class="pill paid">checkout ${money(s.checkout)}</span>` : s.cart ? `<span class="pill info">cart ${money(s.cart)}</span>` : '<span class="pill info">identified</span>'}` : `<span class="muted">Anonymous visitor</span>`;
  const loc = `${FLAG(s.country)} ${esc(s.city || COUNTRY[s.country] || s.country || 'Unknown')}${s.city && s.country ? `<span class="muted">, ${esc(COUNTRY[s.country] || s.country)}</span>` : ''}`;
  const dev = `${esc(s.browser || '')}${s.os ? ` · ${esc(s.os)}` : ''}<div class="muted" style="font-size:12px">${esc(s.device || '')}</div>`;
  const trail = s.trail.slice().reverse();
  const bl = Number(s.blockedUntil || 0) > Date.now() ? ` <span class="pill danger" title="paused until ${tm(Number(s.blockedUntil))}">⏸ ${Math.ceil((Number(s.blockedUntil) - Date.now()) / 60000)} min</span>` : '';
  return `<tr class="sess ${st}"><td><span class="sdot" style="background:${color}" title="${stLabel}"></span></td><td>${who}${bl}${s.email ? `<div class="muted" style="font-size:12px">${esc(s.email)}</div>` : `<div class="muted" style="font-size:12px">id ${esc(s.id)}</div>`}</td><td>${loc}</td><td>${dev}</td><td>${esc(s.ref || '–')}</td><td class="r"><b>${s.views}</b></td><td><div class="cur">${esc(prettyPath(s.cur))}</div><div class="muted" style="font-size:12px">${esc(s.cur || '')}</div></td><td class="num">${dur(s.last - s.first)}<div class="muted" style="font-size:12px">${ago(s.last)}</div></td><td>${detailLink ? `<a class="btn ghost sm" href="/admin/live/visitor/${esc(s.id)}">Trail →</a>` : ''}</td></tr>
<tr class="trail-row"><td></td><td colspan="8"><details><summary class="muted" style="cursor:pointer;font-size:12px">Page trail (${s.views} view${s.views === 1 ? '' : 's'})</summary><ol class="trail">${trail.map((t) => `<li><span>${tm(t.at)}</span> ${esc(prettyPath(t.path))} <span class="muted">${esc(t.path)}</span></li>`).join('')}</ol></details></td></tr>`;
}
const SESS_CSS = `.sdot{display:inline-block;width:10px;height:10px;border-radius:50%;box-shadow:0 0 0 3px rgba(255,255,255,.06),0 0 10px currentColor}tr.sess.active td{background:rgba(52,211,153,.07)}tr.trail-row td{padding:0 12px 10px;border-bottom:1px solid var(--line2)}tr.trail-row:hover td{background:transparent}.trail{margin:8px 0 0;padding-left:18px;font-size:12.5px;display:grid;gap:3px}.trail span:first-child{font-variant-numeric:tabular-nums;color:var(--muted);margin-right:6px}.cur{font-weight:600;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#map{height:520px;border-radius:14px;background:radial-gradient(600px 400px at 50% 45%,rgba(255,214,10,.05),transparent 70%),#0A0D15;overflow:hidden;border:1px solid var(--line)}.leaflet-container{font:inherit}.mk-pop b{display:block;margin-bottom:2px}`;

const TR_RANGES = [[15, '15 min', 1], [30, '30 min', 1], [60, '1 h', 2], [180, '3 h', 5], [360, '6 h', 10], [720, '12 h', 20], [1440, '24 h', 30]]; // [minutes, label, minutes per bar]
const trRange = (v) => (TR_RANGES.find((r) => r[0] === Number(v)) || TR_RANGES[1])[0];
async function liveData(tr = 30) {
  tr = trRange(tr);
  const [live, activity, S, visitsToday, sessions, series] = await Promise.all([stock.liveStats(30), stock.listActivity(40), orderStats(), stock.visitStats(1), stock.listSessions(3, 20), tr > 30 ? stock.minuteSeries(tr) : null]);
  const sum = (list, k = 'views') => list.reduce((a, m) => a + (m[k] || 0), 0);
  return { live, activity, S, visitsToday, sessions, sum, tr, series };
}
async function liveFragment(data) {
  const { live, activity, S, visitsToday, sessions, sum, tr = 30, series } = data || (await liveData());
  const now3 = sessions.filter((s) => Date.now() - s.last < 1 * 60000).length, idleN = sessions.filter((s) => { const a = Date.now() - s.last; return a >= 60000 && a < 2 * 60000; }).length, m30 = sum(live);
  const agg = (prefix, n = 8) => { const o = {}; for (const m of live) for (const [k, v] of Object.entries(m)) if (k.startsWith(prefix)) o[k.slice(prefix.length)] = (o[k.slice(prefix.length)] || 0) + v; return Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n); };
  const pages = agg('u:').map(([u, n]) => [prettyPath(u), n]);
  const checkouts = sessions.filter((s) => s.checkout && !s.order && Date.now() - Number(s.checkoutAt || s.last) < 3600e3);
  const identified = sessions.filter((s) => s.email).length;
  const todayRev = S.rev(S.today);
  // Traffic chart: selectable range, bars grouped per 1–30 minutes, y-grid, time axis, hover tooltip, summary stats
  const [, trLabel, step] = TR_RANGES.find((r) => r[0] === tr);
  const mins = tr <= 30 ? live.slice(-tr).map((m) => ({ t: new Date(`${m.minute}:00Z`).getTime(), v: m.views || 0 })) : series || [];
  const B = []; for (let i = mins.length; i > 0; i -= step) { const g = mins.slice(Math.max(0, i - step), i); B.unshift({ t: g[0].t, e: g[g.length - 1].t + 60000, v: g.reduce((x, m) => x + m.v, 0) }); }
  const lv = B.map((x) => x.v), max = Math.max(1, ...lv), total = lv.reduce((x, y) => x + y, 0), peakI = lv.indexOf(Math.max(...lv)), nowV = lv[lv.length - 1] || 0, N = B.length || 1;
  const mt = (x) => tm(x.t), span = (x) => (step === 1 ? tm(x.t) : `${tm(x.t)}–${tm(x.e)}`);
  const top = max <= 4 ? 4 : max <= 10 ? 10 : Math.ceil(max / (max > 100 ? 50 : 10)) * (max > 100 ? 50 : 10);
  const tn = Math.max(1, Math.round(N / 6)), prev5 = lv.slice(-2 * tn, -tn).reduce((x, y) => x + y, 0), last5 = lv.slice(-tn).reduce((x, y) => x + y, 0), tw = tn * step, twL = tw >= 60 ? `${tw / 60} h` : `${tw} min`;
  const trend = last5 > prev5 ? ['up', '▲ rising'] : last5 < prev5 ? ['down', '▼ slowing'] : ['flat', '● steady'];
  const xEvery = Math.ceil(N / 6);
  const trPick = `<span class="tr-pick">${TR_RANGES.map(([m, l]) => `<button type="button" data-tr="${m}" class="${m === tr ? 'on' : ''}">${l}</button>`).join('')}</span>`;
  const area = `<div class="tr-stats"><div><b>${num(total)}</b><span>page views</span></div><div><b>${(total / tr).toFixed(1)}</b><span>per minute</span></div><div><b>${total ? num(lv[peakI]) : '–'}</b><span>${total ? `peak · ${span(B[peakI])}` : 'peak'}</span></div><div><b class="now">${num(nowV)}</b><span>${step === 1 ? 'this minute' : `last ${step} min`}</span></div><div><b class="delta ${trend[0]}" style="font-size:12.5px;padding:3px 10px">${trend[1]}</b><span>last ${twL} vs ${twL} before</span></div></div>
<div class="tr"><div class="tr-y"><span>${top}</span><span>${top / 2}</span><span>0</span></div><div class="tr-plot"><i class="tr-g" style="top:0"></i><i class="tr-g" style="top:50%"></i><i class="tr-g" style="top:100%"></i><div class="tr-bars" style="grid-template-columns:repeat(${N},1fr)">${B.map((m, i) => { const v = lv[i], last = i === N - 1; return `<div class="tr-c${last ? ' now' : ''}${total && i === peakI && !last ? ' peak' : ''}${v ? '' : ' zero'}${i > N * 0.7 ? ' rt' : ''}${i < N * 0.15 ? ' lt' : ''}" data-t="${span(m)} · ${num(v)} view${v === 1 ? '' : 's'}"><i style="height:${v ? Math.max(4, (v / top) * 100) : 0}%"></i></div>`; }).join('')}</div></div></div>
<div class="tr-x" style="grid-template-columns:repeat(${N},1fr)">${B.map((m, i) => `<span>${i === N - 1 ? 'now' : i % xEvery === 0 && N - 1 - i >= xEvery / 2 ? mt(m) : ''}</span>`).join('')}</div>
<style>.tr-stats{display:flex;gap:28px;flex-wrap:wrap;margin:2px 0 16px}.tr-stats div{display:flex;flex-direction:column;gap:2px}.tr-stats b{font-size:22px;font-weight:800;letter-spacing:-.4px;color:#fff;font-variant-numeric:tabular-nums;line-height:1.15;width:fit-content}.tr-stats b.now{color:var(--gold);text-shadow:0 0 16px rgba(255,214,10,.5)}.tr-stats span{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;font-weight:700}
.tr{display:grid;grid-template-columns:28px 1fr;gap:8px;height:150px}.tr-y{display:flex;flex-direction:column;justify-content:space-between;text-align:right;font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums;line-height:1;margin:-5px 0}.tr-plot{position:relative}.tr-g{position:absolute;left:0;right:0;border-top:1px dashed var(--line)}.tr-g:last-of-type{border-top-style:solid}
.tr-bars{position:absolute;inset:0;display:grid;grid-template-columns:repeat(30,1fr);gap:4px;align-items:end}.tr-c{position:relative;height:100%;display:flex;align-items:flex-end;justify-content:center;border-radius:6px 6px 0 0}.tr-c:hover{background:rgba(255,255,255,.05)}.tr-c i{display:block;width:100%;max-width:44px;border-radius:5px 5px 1px 1px;background:linear-gradient(180deg,#FFD60A,rgba(255,184,0,.35));transition:height .4s ease,filter .15s}.tr-c:hover i{filter:brightness(1.25)}.tr-c.zero i{height:2px!important;background:rgba(255,255,255,.12);border-radius:1px}.tr-c.peak i{background:linear-gradient(180deg,#fff,#FFD60A 45%,rgba(255,184,0,.4))}.tr-c.now i{background:linear-gradient(180deg,#6EE7B7,rgba(52,211,153,.35));box-shadow:0 0 16px rgba(52,211,153,.55);animation:pulse 1.6s infinite}
.tr-c:hover:after{content:attr(data-t);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#1A2030;color:#fff;font-size:11.5px;font-weight:700;white-space:nowrap;padding:5px 9px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.6),0 0 0 1px rgba(255,214,10,.3);z-index:3;pointer-events:none}.tr-c.rt:hover:after{left:auto;right:0;transform:none}.tr-c.lt:hover:after{left:0;transform:none}.tr-pick{display:inline-flex;gap:2px;background:rgba(0,0,0,.35);border:1px solid var(--line);border-radius:999px;padding:3px}.tr-pick button{font:inherit;font-size:12px;font-weight:700;letter-spacing:0;text-transform:none;color:var(--muted);background:none;border:0;border-radius:999px;padding:4px 11px;cursor:pointer;white-space:nowrap}.tr-pick button:hover{color:#fff}.tr-pick button.on{background:var(--gold);color:var(--ink);box-shadow:0 4px 14px -4px rgba(255,214,10,.7)}.tr-head{flex-wrap:wrap}
.tr-x{display:grid;grid-template-columns:repeat(30,1fr);gap:4px;margin:6px 0 0 36px;font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums}.tr-x span{white-space:nowrap;text-align:center;overflow:visible;width:0;justify-self:center;display:flex;justify-content:center}.tr-x span:last-child{color:var(--green);font-weight:800}
@media(max-width:860px){.tr-bars,.tr-x{gap:2px}.tr-stats{gap:16px}.tr-stats b{font-size:18px}}</style>`;
  return `<div class="grid g5">
<div class="card kpi"><div class="l">Visitors right now</div><div class="v" style="color:#15803D">${now3}</div><div class="d">active in the last minute${idleN ? ` · <span style="color:var(--amber)">${idleN} idle</span>` : ''}</div></div>
<div class="card kpi"><div class="l">On site · 3 min</div><div class="v">${sessions.length}</div><div class="d">${m30} page views · ${identified} identified</div></div>
<div class="card kpi"><div class="l">In checkout</div><div class="v" style="color:var(--amber)">${checkouts.length}</div><div class="d">${checkouts.length ? money(checkouts.reduce((a, s) => a + Number(s.checkout || 0), 0)) + ' in progress' : 'nobody right now'}</div></div>
<div class="card kpi"><div class="l">Top country</div><div class="v">${agg('c:', 1)[0] ? `${FLAG(agg('c:', 1)[0][0])} ${esc(agg('c:', 1)[0][0])}` : '–'}</div><div class="d">${agg('c:', 1)[0] ? `${pct((agg('c:', 1)[0][1] / Math.max(1, m30)) * 100)} of views` : 'no traffic yet'}</div></div>
<div class="card kpi"><div class="l">Today</div><div class="v">${money(todayRev)}</div><div class="d">${S.today.length} order${S.today.length === 1 ? '' : 's'} · ${num(sum(visitsToday))} views</div></div>
</div>
<div class="card tight"><h2>Visitors on the site · last 3 minutes <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:500"><span class="sdot" style="background:#22C55E"></span> active (&lt;1 min) &nbsp;<span class="sdot" style="background:#F59E0B"></span> idle (&lt;2 min) &nbsp;<span class="sdot" style="background:#9CA3AF"></span> inactive · removed after 3 min</span></h2>
<table><thead><tr><th></th><th>Visitor</th><th>Location</th><th>Device</th><th>Source</th><th class="r">Pages</th><th>Now viewing</th><th>On site</th><th></th></tr></thead><tbody>${sessions.map((s) => sessionRow(s)).join('') || empty('No visitors in the last 3 minutes. Sessions appear here within seconds of someone opening the shop.', 9)}</tbody></table></div>
<div class="card"><h2 class="tr-head"><span>Traffic · last ${trLabel} <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:500;margin-left:8px">${B.length ? tm(B[0].t) : ''} → ${tm(Date.now())} · one bar = ${step === 1 ? 'one minute' : `${step} minutes`}</span></span>${trPick}</h2>${area}</div>
<div class="grid g3">
<div class="card"><h2>Pages being viewed</h2>${hbars(pages, m30)}</div>
<div class="card"><h2>Countries</h2>${hbars(agg('c:').map(([c, n]) => [`${FLAG(c)} ${COUNTRY[c] || c}`, n]), m30)}</div>
<div class="card"><h2>Sources</h2>${hbars(agg('ref:'), m30)}</div>
</div>
<div class="grid g2">
<div class="card tight"><h2>Checkouts in progress · last hour</h2><table><tbody>${checkouts.map((s) => `<tr><td class="num">${tm(Number(s.checkoutAt || s.last))}</td><td><b>${esc(s.name || s.email)}</b><div class="muted" style="font-size:12px">${esc(s.email)} · ${FLAG(s.country)} ${esc(s.city || '')}</div></td><td class="r"><b>${money(s.checkout)}</b></td><td>${esc(prettyPath(s.cur))}</td><td class="muted">${ago(s.last)}</td></tr>`).join('') || empty('No checkouts in progress. Customers who enter their e-mail and leave show up under <a href="/admin/orders/abandoned">abandoned carts</a>.', 5)}</tbody></table></div>
<div class="card"><h2>Live activity</h2>${feed(activity, { limit: 14 })}</div>
</div>`;
}
function mapPoints(sessions) {
  return sessions.filter((s) => s.lat && s.lon).map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, city: s.city || '', country: s.country || '', views: s.views, cur: prettyPath(s.cur), last: s.last, who: s.name || s.email || '', order: s.order || '', checkout: s.checkout ? money(s.checkout) : '', state: sessState(s)[0], device: [s.browser, s.os].filter(Boolean).join(' · '), ref: s.ref || '' }));
}
async function livePage() {
  const data = await liveData();
  return `${head('Live view', 'Anonymous until the visitor enters an e-mail at checkout · no cookies, no IP stored', `<span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:nowrap"><span class="live-badge" style="white-space:nowrap"><i></i>LIVE · <span id="live-at">updating…</span></span><select id="live-every" class="btn ghost sm" style="padding:6px 10px"><option value="5000">every 5 s</option><option value="15000">every 15 s</option><option value="60000">every 60 s</option><option value="0">auto-refresh off</option></select> <button id="live-refresh" class="btn sm" type="button">↻ Refresh now</button></span>`)}
<style>${SESS_CSS}</style>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<div class="card" style="padding:12px"><div id="map"></div><div class="legend" style="margin:10px 4px 0"><span id="map-note" style="font-weight:600;color:var(--text)">Finland</span><span><i style="background:#22C55E;border-radius:50%"></i>active now</span><span><i style="background:#F59E0B;border-radius:50%"></i>idle</span><span><i style="background:#9CA3AF;border-radius:50%"></i>inactive</span><span><i style="background:#FFD60A;border-radius:50%;box-shadow:0 0 0 2px #fff inset"></i>identified / in checkout</span><span class="muted" style="margin-left:auto">bubble size = pages viewed · locations are city-level from the network, not exact</span></div></div>
<div id="live">${await liveFragment(data)}</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>(function(){
var el=document.getElementById('live'),at=document.getElementById('live-at'),busy=false,map,markers={},first=true;
var colors={active:'#22C55E',idle:'#F59E0B',away:'#9CA3AF'};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var DE=[[59.6,19.3],[70.2,31.7]];function initMap(){try{map=L.map('map',{scrollWheelZoom:false,zoomControl:true,minZoom:4,zoomSnap:0.25});map.fitBounds(DE,{padding:[4,4]});map.setMaxBounds([[53.5,4],[72,36]]);map.attributionControl.setPrefix(false);map.createPane('base');map.getPane('base').style.zIndex=200;fetch('/admin-map/nordic.json').then(function(r){return r.json()}).then(function(g){L.geoJSON(g,{pane:'base',interactive:false,style:function(f){return f.properties.cc==='FI'?{color:'#FFD60A',weight:1.6,opacity:.75,fillColor:'#FFD60A',fillOpacity:.07}:{color:'#ffffff',weight:.8,opacity:.14,fillColor:'#ffffff',fillOpacity:.025}}}).addTo(map);[['Helsinki',60.17,24.94],['Tampere',61.5,23.76],['Turku',60.45,22.27],['Oulu',65.01,25.47],['Jyväskylä',62.24,25.75],['Kuopio',62.89,27.68],['Rovaniemi',66.5,25.73]].forEach(function(c){L.marker([c[1],c[2]],{pane:'base',interactive:false,icon:L.divIcon({className:'city-l',html:'<i></i>'+c[0],iconSize:[0,0]})}).addTo(map)})}).catch(function(){});}catch(e){map=null}}
function draw(all){if(!map)return;var seen={};var b=[];var pts=all.filter(function(p){return !p.country||p.country==='FI'});pts.forEach(function(p){seen[p.id]=1;var r=Math.min(22,8+Math.sqrt(p.views)*3);var ident=!!(p.who||p.checkout||p.order);var opt={radius:r,color:ident?'#ffffff':colors[p.state],weight:ident?2:1.5,fillColor:ident?'#FFD60A':colors[p.state],fillOpacity:p.state==='away'?0.35:0.65};var html='<div class="mk-pop">'+(p.who?'<b>'+esc(p.who)+'</b>':'<b>Anonymous visitor</b>')+(p.order?'<span class="pill ok">order '+esc(p.order)+'</span> ':'')+(p.checkout?'<span class="pill paid">checkout '+esc(p.checkout)+'</span>':'')+'<div>'+esc(p.city)+(p.country?', '+esc(p.country):'')+'</div><div>'+p.views+' page'+(p.views===1?'':'s')+' · now: '+esc(p.cur)+'</div><div class="muted">'+esc(p.device)+(p.ref?' · '+esc(p.ref):'')+'</div><a href="/admin/live/visitor/'+esc(p.id)+'">Page trail →</a></div>';
var j=(Math.sin(parseInt(p.id.slice(0,4),36)||1)*0.03),k=(Math.cos(parseInt(p.id.slice(4,8),36)||1)*0.04);var ll=[p.lat+j,p.lon+k];
if(markers[p.id]){markers[p.id].setLatLng(ll).setStyle(opt).setRadius(r).setPopupContent(html)}else{markers[p.id]=L.circleMarker(ll,opt).bindPopup(html).addTo(map)}b.push(ll)});
Object.keys(markers).forEach(function(id){if(!seen[id]){map.removeLayer(markers[id]);delete markers[id]}});var out=all.filter(function(p){return p.country&&p.country!=='FI'}).length;var n=document.getElementById('map-note');if(n)n.textContent='Finland'+(out?' · '+out+' visitor'+(out===1?'':'s')+' outside FI not shown':'');
if(first){first=false}}
var trSel=30;try{trSel=Number(localStorage.getItem('tw-live-tr'))||30}catch(e){}
el.addEventListener('click',function(e){var b=e.target.closest('[data-tr]');if(!b)return;trSel=Number(b.getAttribute('data-tr'));try{localStorage.setItem('tw-live-tr',String(trSel))}catch(x){}el.querySelectorAll('[data-tr]').forEach(function(x){x.classList.toggle('on',x===b)});(function go(){if(busy){setTimeout(go,250)}else tick(true)})()});
function tick(force){if(busy||(document.hidden&&!force))return;busy=true;var btn=document.getElementById('live-refresh');if(btn){btn.disabled=true;btn.textContent='↻ Refreshing…'}fetch('/admin/api/live?tr='+trSel,{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.json()}).then(function(j){if(j&&j.html){var open={};el.querySelectorAll('details[open]').forEach(function(d,i){open[d.closest('tr').previousElementSibling&&d.closest('tr').previousElementSibling.querySelector('a[href*=visitor]')?d.closest('tr').previousElementSibling.querySelector('a[href*=visitor]').getAttribute('href'):i]=1});el.innerHTML=j.html;el.querySelectorAll('tr.trail-row').forEach(function(tr){var a=tr.previousElementSibling&&tr.previousElementSibling.querySelector('a[href*=visitor]');if(a&&open[a.getAttribute('href')])tr.querySelector('details').open=true});at.textContent=j.at;draw(j.visitors||[])}}).catch(function(){}).then(function(){busy=false;var btn=document.getElementById('live-refresh');if(btn){btn.disabled=false;btn.textContent='↻ Refresh now'}})}
initMap();draw(${JSON.stringify(mapPoints(data.sessions))});var timer=null;function schedule(){if(timer)clearInterval(timer);timer=null;var ms=Number(document.getElementById('live-every').value);try{localStorage.setItem('tw-live-every',String(ms))}catch(e){}if(ms>0)timer=setInterval(tick,ms)}try{var saved=localStorage.getItem('tw-live-every');if(saved!==null)document.getElementById('live-every').value=saved}catch(e){}schedule();document.getElementById('live-every').addEventListener('change',schedule);document.getElementById('live-refresh').addEventListener('click',function(){tick(true)});document.addEventListener('visibilitychange',function(){if(!document.hidden)tick()});at.textContent=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});if(trSel!==30)tick(true);
})();</script>`;
}
async function visitorPage(vid) {
  const s = await stock.getSession(vid);
  if (!s) return null;
  const [st, color, stLabel] = sessState(s);
  const trail = s.trail.slice().reverse();
  const products = [...new Set(trail.map((t) => (/^\/products\/([^/?#]+)/.exec(t.path) || [])[1]).filter(Boolean))].map((h) => D.productByHandle(h)).filter(Boolean);
  return `${head(`${s.name || s.email ? esc(s.name || s.email) : 'Anonymous visitor'} <span class="sdot" style="background:${color}"></span> <span class="muted" style="font-size:14px;font-weight:500">${stLabel}</span>`, `${FLAG(s.country)} ${esc(s.city || '')}${s.region ? `, ${esc(s.region)}` : ''}${s.country ? ` · ${esc(COUNTRY[s.country] || s.country)}` : ''} · ${esc([s.browser, s.os, s.device].filter(Boolean).join(' · '))} · source: ${esc(s.ref || '–')}`, '<a class="btn ghost sm" href="/admin/live">← Live view</a>')}
<style>${SESS_CSS}</style>
<div class="grid g4"><div class="card kpi"><div class="l">Pages viewed</div><div class="v">${s.views}</div></div><div class="card kpi"><div class="l">Time on site</div><div class="v">${dur(s.last - s.first)}</div><div class="d">since ${tm(s.first)}</div></div><div class="card kpi"><div class="l">Last seen</div><div class="v" style="font-size:20px">${ago(s.last)}</div><div class="d">${dt(s.last)}</div></div><div class="card kpi"><div class="l">Status</div><div class="v" style="font-size:18px">${s.order ? `<span class="pill ok">Order ${esc(s.order)}</span>` : s.checkout ? `<span class="pill paid">In checkout · ${money(s.checkout)}</span>` : s.cart ? `<span class="pill info">Cart · ${money(s.cart)}</span>` : s.email ? '<span class="pill info">Identified</span>' : '<span class="pill pending">Browsing</span>'}</div>${s.email ? `<div class="d"><a href="mailto:${esc(s.email)}">${esc(s.email)}</a>${s.orderId ? ` · <a href="/admin/orders/${encodeURIComponent(s.orderId)}">open order →</a>` : ''}</div>` : ''}</div></div>
${(() => { const bu = Number(s.blockedUntil || 0); const on = bu > Date.now(); return `<div class="card" style="margin-bottom:16px"><div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between"><div><h2 style="margin:0 0 4px">Time-out</h2><div class="muted" style="font-size:13px">${on ? `This visitor is paused until <b>${tm(bu)}</b> (${Math.ceil((bu - Date.now()) / 60000)} min left). They see a countdown page instead of the shop.` : 'Pause this visitor for a few minutes. They see a friendly countdown page and the shop unlocks automatically when the time is up.'}</div></div>
${on ? `<form method="post" action="/admin/live/visitor/${esc(s.id)}/untimeout"><button class="btn sm" type="submit">Lift time-out</button></form>` : `<form method="post" action="/admin/live/visitor/${esc(s.id)}/timeout" style="display:flex;gap:8px;align-items:center"><label class="muted" style="font-size:13px">Minutes</label><input type="number" name="minutes" value="5" min="1" max="1440" style="width:80px"><input type="text" name="reason" placeholder="Reason (internal)" style="width:180px"><button class="btn danger sm" type="submit">Time out</button></form>`}</div></div>`; })()}
<div class="grid g32"><div class="card"><h2>Page trail</h2><ol class="trail" style="font-size:13.5px;gap:8px">${trail.map((t, i) => `<li><span>${tm(t.at)}</span> <b>${esc(prettyPath(t.path))}</b> <span class="muted">${esc(t.path)}</span>${i < trail.length - 1 ? ` <span class="muted">· ${dur(trail[i + 1].at - t.at)}</span>` : ' <span class="pill ok">current</span>'}</li>`).join('') || '<li class="muted">No pages recorded.</li>'}</ol></div>
<div class="card tight"><h2>Products viewed</h2><table><tbody>${products.map((p) => `<tr><td><img src="${thumb(p)}" alt=""></td><td><a href="/admin/products/${p.handle}">${esc(p.title)}</a><div class="muted" style="font-size:12px">${money(p.price)} · stock ${liveStock(p)}</div></td></tr>`).join('') || empty('No product pages yet.', 2)}</tbody></table></div></div>`;
}

async function ordersList(url) {
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  const st = url.searchParams.get('status') || '';
  const all = await stock.listOrders(500);
  let orders = all;
  if (st) orders = orders.filter((o) => o.status === st);
  if (q) orders = orders.filter((o) => [o.number, o.email, o.name, o.id, o.address && o.address.city, o.tracking].some((x) => String(x || '').toLowerCase().includes(q)));
  const count = (s) => all.filter((o) => !s || o.status === s).length;
  const tab = (s, l) => `<a href="/admin/orders${s ? `?status=${s}` : ''}" class="${st === s ? 'on' : ''}">${l}<b>${count(s)}</b></a>`;
  const total = orders.filter((o) => o.status !== 'refunded' && o.status !== 'cancelled').reduce((a, o) => a + o.total, 0);
  return `${head('Orders', `${orders.length} order${orders.length === 1 ? '' : 's'}${q ? ` matching “${esc(q)}”` : ''} · ${money(total)}`, '<a class="btn ghost sm" href="/admin/orders/export.csv">Export CSV</a>')}
<div class="tabs">${tab('', 'All')}${tab('paid', 'To ship')}${tab('shipped', 'Shipped')}${tab('refunded', 'Refunded')}${tab('cancelled', 'Cancelled')}<a href="/admin/orders/abandoned">Abandoned carts</a></div>
<form class="search" method="get" action="/admin/orders"><input type="search" name="q" value="${esc(q)}" placeholder="Order no., name, e-mail, city, tracking number"><input type="hidden" name="status" value="${esc(st)}"><button class="btn sm" type="submit">Search</button></form>
<div class="card tight"><table><thead><tr><th>Order</th><th class="hide">Date</th><th>Customer</th><th class="hide">Items</th><th class="hide">Payment</th><th class="r">Total</th><th>Status</th></tr></thead><tbody>
${orders.map((o) => `<tr><td><a href="/admin/orders/${encodeURIComponent(o.id)}"><b>${esc(o.number)}</b></a></td><td class="hide num">${dt(o.paidAt || o.created)}</td><td>${esc(o.name || o.email)}<div class="muted" style="font-size:12px">${esc(o.address && o.address.city)}</div></td><td class="hide num">${o.lines.reduce((a, l) => a + l.quantity, 0)}</td><td class="hide">${esc(o.paymentLabel)}</td><td class="r">${money(o.total)}${o.refundedCents ? `<div class="muted" style="font-size:12px">−${money(o.refundedCents)}</div>` : ''}</td><td>${pill(o.status)}${o.tracking ? `<div class="muted" style="font-size:12px">${esc(o.carrier)} ${esc(o.tracking)}</div>` : ''}</td></tr>`).join('') || empty('No orders found.', 7)}</tbody></table></div>`;
}

async function orderDetail(id) {
  const o = await stock.getOrder(id);
  if (!o) return null;
  const ev = await stock.listEvents(o.id);
  const a = o.address || {};
  const opts = Object.keys(CARRIERS).map((c) => `<option${(o.carrier || 'Posti') === c ? ' selected' : ''}>${c}</option>`).join('');
  const customerOrders = o.email ? (await stock.listCustomers()).find((c) => c.email === o.email.toLowerCase()) : null;
  return `${head(`${esc(o.number || o.id)} ${pill(o.status)}`, `${dt(o.paidAt || o.created)} · ${esc(o.paymentLabel)} · <a href="https://dashboard.stripe.com/payments/${esc(o.id)}" target="_blank" rel="noopener">Open in Stripe ↗</a>${o.receiptUrl ? ` · <a href="${esc(o.receiptUrl)}" target="_blank" rel="noopener">Receipt</a>` : ''}`, '<a class="btn ghost sm" href="/admin/orders">← Orders</a>')}
<div class="grid g23"><div>
<div class="card tight"><h2>Items</h2><table><thead><tr><th></th><th>Product</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Total</th></tr></thead><tbody>${o.lines.map((l) => `<tr><td><img src="${esc(l.image || '')}" alt=""></td><td>${l.gift ? `${esc(l.title)} <span class="pill gold">Free gift</span>` : `<a href="/admin/products/${esc(l.handle)}">${esc(l.title)}</a>`}${l.preorder && !(D.productByHandle(l.handle) || {}).released ? ` <span class="pill gold">Pre-order${l.release ? ` · ${esc(l.release)}` : ''}</span>` : ''}</td><td class="r">${l.quantity}</td><td class="r">${money(l.price)}</td><td class="r">${money(l.price * l.quantity)}</td></tr>`).join('')}<tr><td></td><td><b>Total</b> <span class="muted">· free shipping · incl. 19% VAT ${money(Math.round(o.total - o.total / 1.19))}</span></td><td></td><td></td><td class="r"><b>${money(o.total)}</b></td></tr>${o.refundedCents ? `<tr><td></td><td style="color:var(--red)">Refunded ${o.refundedAt ? dd(o.refundedAt) : ''}</td><td></td><td></td><td class="r" style="color:var(--red)">−${money(o.refundedCents)}</td></tr>` : ''}</tbody></table></div>
<div class="card"><h2>Fulfilment</h2>${o.status === 'shipped' ? `<p><span class="pill shipped">Shipped</span> ${dt(o.shippedAt)} · ${esc(o.carrier)} <b>${esc(o.tracking)}</b>${o.tracking && CARRIERS[o.carrier] ? ` · <a href="${CARRIERS[o.carrier](o.tracking)}" target="_blank" rel="noopener">Track ↗</a>` : ''}</p>` : '<p class="muted">Not shipped yet. Enter the tracking number — the customer automatically receives the shipping confirmation e-mail.</p>'}
<form method="post" action="/admin/orders/${encodeURIComponent(o.id)}/ship" class="row" style="grid-template-columns:130px 1fr auto"><div><label>Carrier</label><select name="carrier">${opts}</select></div><div><label>Tracking number</label><input name="tracking" value="${esc(o.tracking || '')}" placeholder="e.g. 00340434161234567890" autocomplete="off"></div><button class="btn" type="submit">${o.status === 'shipped' ? 'Update & resend' : 'Mark as shipped ✓'}</button></form></div>
<div class="card"><h2>Timeline</h2><ul class="tl">${ev.map((e) => `<li><span>${dt(e.at)}</span><div>${esc(e.text)}</div></li>`).join('') || '<li><span></span><div class="muted">No entries.</div></li>'}</ul>
<form method="post" action="/admin/orders/${encodeURIComponent(o.id)}/note" class="row" style="grid-template-columns:1fr auto;margin-top:12px"><input name="text" placeholder="Internal note …" required><button class="btn ghost sm" type="submit">Add note</button></form></div>
</div><div>
<div class="card"><h2>Customer</h2><p style="line-height:1.7;margin:0 0 8px"><b>${esc(o.shipName || o.name)}</b><br>${esc(a.line1)}${a.line2 ? `<br>${esc(a.line2)}` : ''}<br>${esc(a.postal_code)} ${esc(a.city)}<br>Finland</p><p style="margin:0 0 8px"><a href="mailto:${esc(o.email)}">${esc(o.email)}</a>${o.phone ? `<br>${esc(o.phone)}` : ''}</p>${customerOrders ? `<p class="muted" style="margin:0 0 8px">${customerOrders.orders} order${customerOrders.orders === 1 ? '' : 's'} · ${money(customerOrders.revenue)} lifetime · customer since ${dd(customerOrders.first)}</p>` : ''}<p style="margin:0"><a href="/admin/customers/${encodeURIComponent(o.email || '')}">All orders from this customer →</a></p>${o.newsletter ? '<p class="muted" style="margin:8px 0 0">✓ Subscribed to newsletter</p>' : ''}</div>
<div class="card"><h2>Actions</h2><div style="display:grid;gap:8px">
<form method="post" action="/admin/orders/${encodeURIComponent(o.id)}/resend"><button class="btn ghost sm" type="submit">Resend order confirmation</button></form>
${o.status === 'paid' ? `<form method="post" action="/admin/orders/${encodeURIComponent(o.id)}/cancel" onsubmit="return confirm('Cancel this order and return the items to stock? The payment is NOT refunded by this – do that separately.')"><button class="btn ghost sm" type="submit">Cancel order (restock)</button></form>` : ''}
${o.status !== 'refunded' && o.status !== 'pending' && !o.refundedCents ? `<form method="post" action="/admin/orders/${encodeURIComponent(o.id)}/refund" onsubmit="return confirm('Refund ${money(o.total)} to the customer via Stripe? This cannot be undone.')"><button class="btn danger sm" type="submit">Refund ${money(o.total)} via Stripe</button></form>` : ''}
${o.status === 'refunded' && !o.restocked ? `<form method="post" action="/admin/orders/${encodeURIComponent(o.id)}/restock" onsubmit="return confirm('Return the items to stock?')"><button class="btn ghost sm" type="submit">Return items to stock</button></form>` : ''}
</div><p class="muted" style="margin:10px 0 0">Refunds only happen when you click here or in Stripe — never automatically.</p></div>
</div></div>`;
}

async function abandoned() {
  const carts = await stock.listCarts();
  const hours = await stock.getSetting('reminder_hours', '2');
  return `${head('Abandoned carts', `Customers who entered their e-mail at checkout but didn’t pay. A reminder goes out automatically after ${esc(hours)} h (<a href="/admin/settings">Settings</a>).`)}
<div class="grid g3"><div class="card kpi"><div class="l">Open carts</div><div class="v">${carts.length}</div></div><div class="card kpi"><div class="l">Value</div><div class="v">${money(carts.reduce((a, c) => a + c.total, 0))}</div></div><div class="card kpi"><div class="l">Reminded</div><div class="v">${carts.filter((c) => c.reminded).length}</div><div class="d">of ${carts.length}</div></div></div>
<div class="card tight"><table><thead><tr><th>When</th><th>Customer</th><th class="hide">Items</th><th class="r">Value</th><th>Reminder</th><th></th></tr></thead><tbody>${carts.map((c) => `<tr><td class="num">${dt(c.at)}<div class="muted" style="font-size:12px">${ago(c.at)}</div></td><td>${esc(c.name)}<div><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div></td><td class="hide">${c.lines.map((l) => `${l.quantity}× ${esc(l.title)}`).join('<br>')}</td><td class="r">${money(c.total)}</td><td>${c.reminded ? `<span class="pill ok">sent ${dd(c.reminded)}</span>` : '<span class="pill pending">not yet</span>'}</td><td><form method="post" action="/admin/orders/abandoned/remind"><input type="hidden" name="token" value="${esc(c.token)}"><button class="btn sm ghost" type="submit">Send reminder</button></form></td></tr>`).join('') || empty('No abandoned carts.', 6)}</tbody></table></div>`;
}

const PRICE_OVER = (v) => v.price !== v.base_price;
async function products(url) {
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const [views, bis, orders] = await Promise.all([stock.productViews(), stock.countBackInStock(), stock.listOrders(1000)]);
  const sold = {}; for (const o of orders) if (o.status !== 'pending' && o.status !== 'cancelled') for (const l of o.lines) sold[l.handle] = (sold[l.handle] || 0) + l.quantity;
  let list = D.ACTIVE.filter((p) => !q || p.title.toLowerCase().includes(q) || p.handle.includes(q));
  const sort = url.searchParams.get('sort') || 'stock';
  list = [...list].sort((a, b) => sort === 'views' ? (views[b.handle] || 0) - (views[a.handle] || 0) : sort === 'sold' ? (sold[b.handle] || 0) - (sold[a.handle] || 0) : sort === 'price' ? b.price - a.price : liveStock(a) - liveStock(b));
  const out = D.ACTIVE.filter((p) => liveStock(p) === 0 && p.variants[0].inventory_policy !== 'continue').length;
  const pre = D.ACTIVE.filter((p) => p.tags.includes('Pre-order')).length;
  const inv = D.ACTIVE.reduce((a, p) => a + liveStock(p) * p.price, 0);
  return `${head('Products & stock', `${D.ACTIVE.length} active products · stock and prices you change here apply to the shop and the Google feed immediately.`)}
<div class="grid g4"><div class="card kpi"><div class="l">Active products</div><div class="v">${D.ACTIVE.length}</div></div><div class="card kpi"><div class="l">Sold out</div><div class="v" style="color:${out ? 'var(--red)' : 'inherit'}">${out}</div></div><div class="card kpi"><div class="l">Pre-orders</div><div class="v">${pre}</div></div><div class="card kpi"><div class="l">Stock value</div><div class="v">${money(inv)}</div><div class="d">at current selling prices</div></div></div>
<form class="search" method="get"><input type="search" name="q" value="${esc(q)}" placeholder="Search products"><select name="sort"><option value="stock"${sort === 'stock' ? ' selected' : ''}>Sort: stock (low first)</option><option value="sold"${sort === 'sold' ? ' selected' : ''}>Sort: best sellers</option><option value="views"${sort === 'views' ? ' selected' : ''}>Sort: most viewed</option><option value="price"${sort === 'price' ? ' selected' : ''}>Sort: price</option></select><button class="btn sm" type="submit">Apply</button></form>
<style>.inl{display:inline-flex;align-items:center;gap:4px}.inl input{width:76px;padding:7px 8px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}.inl input.price{width:92px}.inl button.pm{width:28px;height:32px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);border-radius:8px;font-weight:700;cursor:pointer;color:var(--muted)}.inl button.pm:hover{background:rgba(255,214,10,.15);color:var(--gold)}tr.dirty td{background:rgba(255,214,10,.08)}tr.dirty .btn-save{background:var(--gold);color:var(--ink)}.btn-save{background:rgba(255,255,255,.07);color:var(--text);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}.btn-save:disabled{opacity:.5;cursor:default}.orig{font-size:11px;color:var(--muted);display:block;text-align:right}</style>
<div class="card tight">${list.map((p) => `<form id="f-${p.variants[0].id}" method="post" action="/admin/products/${p.handle}/variant/${p.variants[0].id}"><input type="hidden" name="back" value="${esc(`/admin/products${url.search || ''}`)}"></form>`).join('')}<table><thead><tr><th></th><th>Product</th><th class="r">Price €</th><th class="r">Stock</th><th></th><th class="r hide">Sold</th><th class="r hide">Views</th><th class="hide">Waitlist</th></tr></thead><tbody>${list.map((p) => { const v = p.variants[0]; const over = PRICE_OVER(v); const wl = Object.entries(bis).filter(([vid]) => p.variants.some((x) => String(x.id) === vid)).reduce((a, [, n]) => a + n, 0); const multi = p.variants.length > 1; const f = `f-${v.id}`; return `<tr data-row><td><img src="${thumb(p)}" alt=""></td><td><a href="/admin/products/${p.handle}">${esc(p.title)}</a>${p.tags.includes('Pre-order') ? ' <span class="pill gold">Pre-order</span>' : ''}${multi ? ` <span class="pill pending">${p.variants.length} variants · edit on product page</span>` : ''}</td><td class="r">${multi ? money(p.price) : `<span class="inl"><input class="price" form="${f}" name="price" type="text" inputmode="decimal" value="${(v.price / 100).toFixed(2)}" data-orig="${(v.price / 100).toFixed(2)}"></span>${over ? `<span class="orig">orig. ${money(v.base_price)}</span>` : ''}`}</td><td class="r">${multi ? `<b>${liveStock(p)}</b>` : v.inventory_policy === 'continue' ? `<span class="inl"><button type="button" class="pm" data-d="-1">−</button><input form="${f}" name="stock" type="number" min="0" value="${v.inventory_quantity}" data-orig="${v.inventory_quantity}" title="Pre-order: sells even at 0"><button type="button" class="pm" data-d="1">+</button></span><span class="orig">∞ pre-order</span>` : `<span class="inl"><button type="button" class="pm" data-d="-1">−</button><input form="${f}" name="stock" type="number" min="0" value="${v.inventory_quantity}" data-orig="${v.inventory_quantity}" style="color:${liveStock(p) === 0 ? 'var(--red)' : liveStock(p) <= 3 ? 'var(--amber)' : 'inherit'}"><button type="button" class="pm" data-d="1">+</button></span>`}</td><td>${multi ? '' : `<button class="btn sm btn-save" form="${f}" type="submit" disabled>Save</button>`}</td><td class="r hide">${sold[p.handle] || 0}</td><td class="r hide">${num(views[p.handle] || 0)}</td><td class="hide">${wl ? `<span class="pill info">${wl} waiting</span>` : ''}</td></tr>`; }).join('') || empty('No products match.', 8)}</tbody></table></div>
<script>(function(){function check(tr){var d=false;tr.querySelectorAll('input[data-orig]').forEach(function(i){if(String(i.value).trim()!==i.getAttribute('data-orig'))d=true});tr.classList.toggle('dirty',d);var b=tr.querySelector('.btn-save');if(b)b.disabled=!d}document.querySelectorAll('tr[data-row]').forEach(function(tr){tr.querySelectorAll('input[data-orig]').forEach(function(i){i.addEventListener('input',function(){check(tr)})});tr.querySelectorAll('button.pm').forEach(function(b){b.addEventListener('click',function(){var i=b.parentElement.querySelector('input');i.value=Math.max(0,(parseInt(i.value,10)||0)+Number(b.getAttribute('data-d')));check(tr)})})});window.addEventListener('beforeunload',function(e){if(document.querySelector('tr.dirty')){e.preventDefault();e.returnValue=''}});document.querySelectorAll('form[id^=f-]').forEach(function(f){f.addEventListener('submit',function(){document.querySelectorAll('tr.dirty').forEach(function(t){t.classList.remove('dirty')})})})})();</script>`;
}

async function productEdit(handle) {
  const p = D.productByHandle(handle);
  if (!p) return null;
  const [bis, views, orders] = await Promise.all([stock.countBackInStock(), stock.productViews(), stock.listOrders(1000)]);
  const sold = orders.filter((o) => o.status !== 'pending' && o.status !== 'cancelled').flatMap((o) => o.lines.filter((l) => l.handle === p.handle).map((l) => ({ ...l, order: o })));
  const units = sold.reduce((a, l) => a + l.quantity, 0);
  return `${head(esc(p.title), `<a href="${p.url}" target="_blank">View in shop ↗</a> · ${esc(p.vendor)} · ${p.tags.includes('Pre-order') ? 'Pre-order' : 'In-stock item'}`, '<a class="btn ghost sm" href="/admin/products">← Products</a>')}
<div class="grid g4"><div class="card kpi"><div class="l">Stock</div><div class="v">${p.variants[0].inventory_policy === 'continue' ? '∞' : liveStock(p)}</div></div><div class="card kpi"><div class="l">Price</div><div class="v">${money(p.price)}</div>${PRICE_OVER(p.variants[0]) ? `<div class="d">original ${money(p.variants[0].base_price)}</div>` : ''}</div><div class="card kpi"><div class="l">Units sold</div><div class="v">${units}</div><div class="d">${money(sold.reduce((a, l) => a + l.price * l.quantity, 0))} revenue</div></div><div class="card kpi"><div class="l">Page views</div><div class="v">${num(views[p.handle] || 0)}</div><div class="d">${views[p.handle] ? pct((units / views[p.handle]) * 100) + ' view → order' : ''}</div></div></div>
<div class="grid g2"><div class="card"><h2>Stock & price</h2>${p.variants.map((v) => `<form method="post" action="/admin/products/${p.handle}/variant/${v.id}" class="row" style="grid-template-columns:1fr 1fr auto;margin-bottom:10px">${p.variants.length > 1 ? `<div style="grid-column:1/-1"><b>${esc(v.title)}</b></div>` : ''}<div><label>Stock (units)</label><input name="stock" type="number" min="0" value="${v.inventory_quantity}"${v.inventory_policy === 'continue' ? ' title="Pre-order: sells even at 0"' : ''}></div><div><label>Price in € <span class="muted">(original ${money(v.base_price)})</span></label><input name="price" type="text" inputmode="decimal" value="${(v.price / 100).toFixed(2)}"></div><button class="btn" type="submit">Save</button>${bis[String(v.id)] ? `<p class="muted" style="grid-column:1/-1;margin:0"><span class="pill info">${bis[String(v.id)]} on waitlist</span> they are e-mailed automatically when you set stock above 0.</p>` : ''}</form>`).join('')}
<p class="muted">Pre-order items stay purchasable at 0 stock. Price changes apply to the shop and the Google feed right away.</p></div>
<div class="card"><h2>Product</h2><div style="display:flex;gap:16px;align-items:flex-start"><img src="${thumb(p)}" alt="" style="width:110px;height:110px;object-fit:contain;border:1px solid var(--line);border-radius:12px;background:#fff"><div class="muted" style="line-height:1.8">ID ${p.id} · variant ${p.variants[0].id}${p.variants[0].barcode ? ` · EAN ${esc(p.variants[0].barcode)}` : ''}<br>Category: ${esc(p.type)}<br>Tags: ${esc(p.tags.join(', ')) || '–'}<br>Images: ${p.images.length}</div></div><p class="muted" style="margin-top:12px">Texts and images live in <code>data/products.json</code> in the GitHub repo — ask Claude to change them.</p></div></div>
${sold.length ? `<div class="card tight"><h2>Recent orders with this product</h2><table><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th class="r">Qty</th><th>Status</th></tr></thead><tbody>${sold.slice(0, 12).map((l) => `<tr><td><a href="/admin/orders/${encodeURIComponent(l.order.id)}"><b>${esc(l.order.number)}</b></a></td><td class="num">${dt(l.order.paidAt || l.order.created)}</td><td>${esc(l.order.name || l.order.email)}</td><td class="r">${l.quantity}</td><td>${pill(l.order.status)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}

async function customers(url) {
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const all = await stock.listCustomers();
  const list = all.filter((c) => !q || c.email.includes(q) || String(c.name || '').toLowerCase().includes(q));
  const subs = new Set((await stock.listSubscribers()).map((s) => s.email));
  const repeat = all.filter((c) => c.orders > 1).length;
  return `${head('Customers', `${all.length} customers · ${money(all.reduce((a, c) => a + c.revenue, 0))} lifetime revenue`, '<a class="btn ghost sm" href="/admin/customers/export.csv">Export CSV</a>')}
<div class="grid g4"><div class="card kpi"><div class="l">Customers</div><div class="v">${all.length}</div></div><div class="card kpi"><div class="l">Repeat buyers</div><div class="v">${repeat}</div><div class="d">${all.length ? pct((repeat / all.length) * 100) : '–'} of customers</div></div><div class="card kpi"><div class="l">Avg. lifetime value</div><div class="v">${money(all.length ? all.reduce((a, c) => a + c.revenue, 0) / all.length : 0)}</div></div><div class="card kpi"><div class="l">Newsletter opt-in</div><div class="v">${all.filter((c) => subs.has(c.email)).length}</div><div class="d">of ${all.length} customers</div></div></div>
<form class="search" method="get"><input type="search" name="q" value="${esc(q)}" placeholder="Name or e-mail"><button class="btn sm" type="submit">Search</button></form>
<div class="card tight"><table><thead><tr><th>Customer</th><th class="hide">City</th><th class="r">Orders</th><th class="r">Revenue</th><th class="hide">Last order</th><th class="hide">Newsletter</th></tr></thead><tbody>${list.map((c) => `<tr><td><a href="/admin/customers/${encodeURIComponent(c.email)}"><b>${esc(c.name || c.email)}</b></a><div class="muted" style="font-size:12px">${esc(c.email)}</div></td><td class="hide">${esc(c.city)}</td><td class="r">${c.orders}</td><td class="r">${money(c.revenue)}</td><td class="hide num">${dd(c.last)}</td><td class="hide">${subs.has(c.email) ? '<span class="pill ok">yes</span>' : ''}</td></tr>`).join('') || empty('No customers yet.', 6)}</tbody></table></div>`;
}
async function customerDetail(email) {
  const c = (await stock.listCustomers()).find((x) => x.email === email.toLowerCase());
  if (!c) return null;
  return `${head(esc(c.name || c.email), `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a> · customer since ${dd(c.first)} · ${c.orders} order${c.orders === 1 ? '' : 's'} · ${money(c.revenue)} lifetime`, '<a class="btn ghost sm" href="/admin/customers">← Customers</a>')}
<div class="card tight"><table><thead><tr><th>Order</th><th>Date</th><th>Items</th><th class="r">Total</th><th>Status</th></tr></thead><tbody>${c.list.map((o) => `<tr><td><a href="/admin/orders/${encodeURIComponent(o.id)}"><b>${esc(o.number)}</b></a></td><td class="num">${dt(o.created)}</td><td>${o.lines.map((l) => `${l.quantity}× ${esc(l.title)}`).join('<br>')}</td><td class="r">${money(o.total)}</td><td>${pill(o.status)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function messages() {
  const [msgs, wds] = await Promise.all([stock.listMessages('messages'), stock.listMessages('withdrawals')]);
  const row = (m) => `<tr><td class="num">${dt(m.at)}<div class="muted" style="font-size:12px">${ago(m.at)}</div></td><td>${esc(m.Name)}<div><a href="mailto:${esc(m['E-Mail'])}">${esc(m['E-Mail'])}</a></div></td><td>${Object.entries(m).filter(([k]) => !['at', 'Name', 'E-Mail'].includes(k)).map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join('<br>')}</td></tr>`;
  return `${head('Messages', 'Contact form and online withdrawals. Reply by e-mail — the customer already received an automatic acknowledgement.')}
<div class="card tight"><h2>⚠️ Withdrawals <span class="pill warn">${wds.length}</span></h2><table><tbody>${wds.map(row).join('') || empty('No withdrawals.', 3)}</tbody></table></div>
<div class="card tight"><h2>Contact requests <span class="pill info">${msgs.length}</span></h2><table><tbody>${msgs.map(row).join('') || empty('No messages.', 3)}</tbody></table></div>`;
}
async function newsletter() {
  const subs = await stock.listSubscribers();
  const pend = await stock.listMessages('newsletter_pending', 50);
  const d30 = subs.filter((s) => Date.now() - new Date(s.at).getTime() < 30 * 864e5).length;
  return `${head('Newsletter', `${subs.length} confirmed subscribers (double opt-in)`, '<a class="btn ghost sm" href="/admin/newsletter/export.csv">Export CSV</a>')}
<div class="grid g3"><div class="card kpi"><div class="l">Subscribers</div><div class="v">${subs.length}</div></div><div class="card kpi"><div class="l">New · 30 days</div><div class="v">${d30}</div></div><div class="card kpi"><div class="l">Unconfirmed</div><div class="v">${pend.filter((p) => !subs.some((s) => s.email === p.email)).length}</div><div class="d">signed up, not confirmed yet</div></div></div>
<div class="card tight"><h2>Subscribers</h2><table><thead><tr><th>E-mail</th><th>Confirmed</th></tr></thead><tbody>${subs.map((s) => `<tr><td>${esc(s.email)}</td><td class="num">${dt(s.at)}</td></tr>`).join('') || empty('No subscribers yet.', 2)}</tbody></table></div>
<div class="card tight"><h2>Pending confirmation</h2><table><tbody>${pend.filter((p) => !subs.some((s) => s.email === p.email)).slice(0, 30).map((p) => `<tr><td>${esc(p.email)}</td><td class="muted num">${dt(p.at)}</td></tr>`).join('') || empty('–', 2)}</tbody></table></div>
<p class="muted">Export the CSV to use the list in Klaviyo, Mailchimp or similar.</p>`;
}

const AN_RANGES = [[1, 'Today'], [7, '7 days'], [14, '14 days'], [30, '30 days'], [90, '90 days']];
async function analytics(url) {
  const R = (AN_RANGES.find((r) => r[0] === Number(url && url.searchParams.get('d'))) || AN_RANGES[3])[0];
  const [v, S, carts] = await Promise.all([stock.visitStats(Math.max(60, 2 * R)), orderStats(), stock.listCarts().catch(() => [])]);
  const cur = v.slice(-R), prev = v.slice(-2 * R, -R);
  const views = (l) => l.reduce((a, x) => a + (x.views || 0), 0);
  const aggAll = (prefix, list = cur) => { const o = {}; for (const d of list) for (const [k, n] of Object.entries(d)) if (k.startsWith(prefix)) o[k.slice(prefix.length)] = (o[k.slice(prefix.length)] || 0) + n; return Object.entries(o).sort((x, y) => y[1] - x[1]); };
  const agg = (prefix, n = 8) => aggAll(prefix).slice(0, n);
  const inDays = (list) => { const set = new Set(list.map((d) => d.day)); return S.all.filter((o) => S.good(o) && set.has(stock.day(o.paidAt || o.created))); };
  const oCur = inDays(cur), oPrev = inDays(prev), vCur = views(cur), vPrev = views(prev), rCur = S.rev(oCur), rPrev = S.rev(oPrev);
  const conv = vCur ? (oCur.length / vCur) * 100 : 0, convP = vPrev ? (oPrev.length / vPrev) * 100 : 0;
  const label = AN_RANGES.find((r) => r[0] === R)[1].toLowerCase(), vs = R === 1 ? 'vs yesterday' : `vs prev. ${R} days`;
  const pick = `<div class="tabs" style="margin:0">${AN_RANGES.map(([d, l]) => `<a href="/admin/analytics?d=${d}" class="${d === R ? 'on' : ''}">${l}</a>`).join('')}</div>`;

  // funnel: page views → product views → checkout (e-mail entered) → orders
  const curSet = new Set(cur.map((d) => d.day));
  const pv = aggAll('p:').reduce((x, [, n]) => x + n, 0);
  const co = carts.filter((c) => c && c.at && curSet.has(stock.day(c.at))).length + oCur.length;
  const steps = [['Page views', vCur, 'everyone who opened a page'], ['Product views', pv, 'looked at a product'], ['Checkout', co, 'entered their e-mail at checkout'], ['Orders', oCur.length, 'paid']];
  const funnel = steps.map(([l, n, hint], i) => { const w = vCur ? Math.max(n ? 6 : 0, (n / vCur) * 100) : 0; const p = i && steps[i - 1][1] ? (n / steps[i - 1][1]) * 100 : null; return `${i ? `<div class="fn-drop">${p === null ? '–' : `▼ ${pct(p)} continue`}</div>` : ''}<div class="fn-row"><div class="fn-l"><b>${l}</b><span>${hint}</span></div><div class="fn-bar"><i style="width:${w}%"></i></div><div class="fn-n"><b>${num(n)}</b><span>${vCur && i ? pct((n / vCur) * 100) + ' of views' : '&nbsp;'}</span></div></div>`; }).join('');

  // by hour of day (Berlin time) and by weekday
  const hours = Array.from({ length: 24 }, (_, h) => cur.reduce((x, d) => x + (d[`h:${String(h).padStart(2, '0')}`] || 0), 0));
  const hMax = Math.max(1, ...hours), hSum = hours.reduce((x, y) => x + y, 0), top3 = hours.map((n, h) => [n, h]).sort((x, y) => y[0] - x[0]).slice(0, 3).filter((x) => x[0]).map((x) => x[1]);
  const hourChart = hSum ? `<div class="hr">${hours.map((n, h) => `<div class="hr-c${top3.includes(h) ? ' top' : ''}" data-t="${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00 · ${num(n)} views · ${pct((n / hSum) * 100)}"><i style="height:${n ? Math.max(3, (n / hMax) * 100) : 0}%"></i><span>${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span></div>`).join('')}</div><p class="muted" style="margin:10px 0 0">Busiest: <b style="color:var(--gold)">${top3.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')}</b> · Berlin time · good hours for ads and new drops</p>` : '<p class="muted">Hourly data is collected since 9 Nov – pick a range that includes recent days.</p>';
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; const wd = WD.map(() => [0, 0]);
  for (const d of cur) { const i = (new Date(`${d.day}T12:00:00Z`).getUTCDay() + 6) % 7; wd[i][0] += d.views || 0; wd[i][1] += 1; }
  const wdAvg = wd.map(([t, n]) => (n ? t / n : 0)), wdMax = Math.max(1, ...wdAvg), wdTop = wdAvg.indexOf(Math.max(...wdAvg));
  const wdChart = `<div class="hr wd">${wdAvg.map((n, i) => `<div class="hr-c${vCur && i === wdTop ? ' top' : ''}" data-t="${WD[i]} · ${num(Math.round(n))} views per day"><i style="height:${n ? Math.max(3, (n / wdMax) * 100) : 0}%"></i><span>${WD[i]}</span></div>`).join('')}</div><p class="muted" style="margin:10px 0 0">${vCur ? `Best day: <b style="color:var(--gold)">${WD[wdTop]}</b> · average views per day` : 'No traffic in this range yet.'}</p>`;

  // devices donut
  const dev = aggAll('dev:'), devSum = dev.reduce((x, [, n]) => x + n, 0), DC = { mobile: '#FFD60A', desktop: '#7CB4FF', tablet: '#B79CFF' }; let off = 0;
  const donut = devSum ? `<div class="dn"><svg viewBox="0 0 42 42" width="150" height="150"><circle cx="21" cy="21" r="15.915" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="5"/>${dev.map(([k, n]) => { const pc = (n / devSum) * 100; const seg = `<circle cx="21" cy="21" r="15.915" fill="none" stroke="${DC[k] || '#8A93A8'}" stroke-width="5" stroke-dasharray="${pc} ${100 - pc}" stroke-dashoffset="${25 - off}" stroke-linecap="butt"/>`; off += pc; return seg; }).join('')}<text x="21" y="20.5" text-anchor="middle" font-size="6" font-weight="800" fill="#fff">${pct((dev[0][1] / devSum) * 100).replace('.0', '')}</text><text x="21" y="25.5" text-anchor="middle" font-size="2.8" fill="#8A93A8">${esc(dev[0][0])}</text></svg><div class="dn-k">${dev.map(([k, n]) => `<div><i style="background:${DC[k] || '#8A93A8'}"></i><span>${esc(k)}</span><b>${num(n)} <span class="muted">· ${pct((n / devSum) * 100)}</span></b></div>`).join('')}</div></div>` : '<p class="muted">Device tracking starts with this update – the chart fills as visitors arrive.</p>';

  // lists
  let rn; try { rn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { rn = null; }
  const cName = (cc) => { try { return rn && /^[A-Z]{2}$/.test(cc) ? rn.of(cc) : cc; } catch (e) { return cc; } };
  const rank = (rows, fmt = (k) => esc(k)) => { const max = Math.max(1, ...rows.map((r) => r[1])); return rows.length ? `<div class="rk">${rows.map(([k, n], i) => `<div class="rk-r"><em>${i + 1}</em><div class="rk-m"><span>${fmt(k)}</span><i style="width:${Math.max(2, (n / max) * 100)}%"></i></div><b>${num(n)}<span>${vCur ? pct((n / vCur) * 100) : ''}</span></b></div>`).join('')}</div>` : '<p class="muted">No data in this range yet.</p>'; };
  const sold = {}; for (const o of oCur) for (const l of o.lines || []) if (l.handle) sold[l.handle] = (sold[l.handle] || 0) + (l.quantity || 1);
  const prodRows = agg('p:', 10).map(([h, n], i) => { const pr = D.productByHandle(h), sl = sold[h] || 0; return `<tr><td class="muted num" style="width:28px">${i + 1}</td><td style="width:48px">${pr && thumb(pr) ? `<img src="${thumb(pr)}" alt="">` : ''}</td><td>${pr ? `<a href="/admin/products/${esc(h)}">${esc(pr.title)}</a>` : esc(h)}</td><td class="r"><b>${num(n)}</b></td><td class="r hide">${vCur ? pct((n / vCur) * 100) : '–'}</td><td class="r">${sl ? `<span class="pill ok">${sl} sold</span>` : '<span class="muted">–</span>'}</td><td class="r hide">${sl && n ? pct((sl / n) * 100) : '<span class="muted">–</span>'}</td></tr>`; }).join('');

  return `${head('Analytics', `${R === 1 ? 'Today' : `Last ${label}`} · cookieless page analytics, no personal data`, pick)}
<div class="grid g4"><div class="card kpi"><div class="l">Page views</div><div class="v">${num(vCur)}</div><div class="d">${delta(vCur, vPrev)} ${vs}${R > 1 ? ` · ${num(Math.round(vCur / R))}/day` : ''}</div></div><div class="card kpi"><div class="l">Orders</div><div class="v">${num(oCur.length)}</div><div class="d">${delta(oCur.length, oPrev.length)} ${vs}</div></div><div class="card kpi"><div class="l">Revenue</div><div class="v">${money(rCur)}</div><div class="d">${delta(rCur, rPrev)} ${vs}${oCur.length ? ` · AOV ${money(rCur / oCur.length)}` : ''}</div></div><div class="card kpi"><div class="l">Conversion</div><div class="v">${conv.toFixed(2)}%</div><div class="d">${delta(conv, convP)} ${vs} · orders ÷ views</div></div></div>
<div class="card"><h2>Traffic & sales <span class="muted" style="font-size:12px;font-weight:600">click a tile to switch the chart · hover a bar for details</span></h2>${PC.render('pc-an', PC.series(stock, S, v.slice(-60)), { metric: 'v', open: false })}</div>
<div class="grid g32"><div class="card"><h2>Funnel · ${R === 1 ? 'today' : label} <span class="muted" style="font-size:12px;font-weight:600;text-transform:none;letter-spacing:0">where visitors drop off</span></h2><div class="fn">${funnel}</div></div><div class="card"><h2>Devices</h2>${donut}</div></div>
<div class="grid g32"><div class="card"><h2>Views by hour of day</h2>${hourChart}</div><div class="card"><h2>Views by weekday</h2>${wdChart}</div></div>
<div class="grid g3"><div class="card"><h2>Sources</h2>${rank(agg('ref:'))}</div><div class="card"><h2>Countries</h2>${rank(agg('c:'), (cc) => `${FLAG(cc)} ${esc(cName(cc))}`)}</div><div class="card"><h2>Cities</h2>${rank(agg('city:'))}</div></div>
<div class="card tight"><h2>Most viewed products · ${R === 1 ? 'today' : label}</h2><table><thead><tr><th></th><th></th><th>Product</th><th class="r">Views</th><th class="r hide">Share</th><th class="r">Sold</th><th class="r hide">View → sale</th></tr></thead><tbody>${prodRows || empty('No product views in this range yet.', 7)}</tbody></table></div>
<style>.fn{display:grid;gap:0}.fn-row{display:grid;grid-template-columns:150px 1fr 110px;gap:14px;align-items:center}.fn-l b{display:block;font-size:13.5px}.fn-l span,.fn-n span{display:block;font-size:11.5px;color:var(--muted)}.fn-bar{height:34px;border-radius:9px;background:rgba(255,255,255,.04);overflow:hidden}.fn-bar i{display:block;height:100%;border-radius:9px;background:linear-gradient(90deg,#FFB800,#FFE55C);box-shadow:0 0 18px rgba(255,214,10,.35);min-width:0;transition:width .5s}.fn-row:nth-of-type(3) .fn-bar i{background:linear-gradient(90deg,#3B82F6,#7CB4FF);box-shadow:0 0 18px rgba(96,165,250,.35)}.fn-row:nth-of-type(5) .fn-bar i{background:linear-gradient(90deg,#8B5CF6,#B79CFF);box-shadow:0 0 18px rgba(183,156,255,.35)}.fn-row:nth-of-type(7) .fn-bar i{background:linear-gradient(90deg,#10B981,#6EE7B7);box-shadow:0 0 18px rgba(52,211,153,.4)}.fn-n{text-align:right}.fn-n b{font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;color:#fff}.fn-drop{margin:5px 0 5px 164px;font-size:11.5px;font-weight:700;color:var(--muted)}
.hr{display:grid;grid-template-columns:repeat(24,1fr);gap:4px;height:150px;align-items:end;padding-bottom:18px;position:relative;border-bottom:1px solid var(--line)}.hr.wd{grid-template-columns:repeat(7,1fr);gap:10px}.hr-c{position:relative;height:100%;display:flex;align-items:flex-end;justify-content:center;border-radius:6px 6px 0 0}.hr-c:hover{background:rgba(255,255,255,.05)}.hr-c i{display:block;width:100%;max-width:46px;border-radius:5px 5px 1px 1px;background:linear-gradient(180deg,rgba(255,214,10,.75),rgba(255,184,0,.2))}.hr-c.top i{background:linear-gradient(180deg,#fff,#FFD60A 40%,rgba(255,184,0,.45));box-shadow:0 0 16px rgba(255,214,10,.5)}.hr-c span{position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}.hr-c:hover:after{content:attr(data-t);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#1A2030;color:#fff;font-size:11.5px;font-weight:700;white-space:nowrap;padding:5px 9px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.6),0 0 0 1px rgba(255,214,10,.3);z-index:3;pointer-events:none}.hr-c:nth-child(-n+5):hover:after{left:0;transform:none}.hr-c:nth-last-child(-n+5):hover:after{left:auto;right:0;transform:none}.hr{margin-bottom:6px}
.dn{display:flex;align-items:center;gap:22px;flex-wrap:wrap}.dn svg{flex:none;filter:drop-shadow(0 0 14px rgba(255,214,10,.25))}.dn-k{display:grid;gap:10px;flex:1;min-width:150px}.dn-k div{display:grid;grid-template-columns:12px 1fr auto;gap:9px;align-items:center;font-size:13.5px;text-transform:capitalize}.dn-k i{width:12px;height:12px;border-radius:4px}.dn-k b{font-variant-numeric:tabular-nums}
.rk{display:grid;gap:11px}.rk-r{display:grid;grid-template-columns:20px 1fr auto;gap:10px;align-items:center;font-size:13.5px}.rk-r em{font-style:normal;font-size:11px;font-weight:800;color:var(--muted);width:20px;height:20px;border-radius:6px;background:rgba(255,255,255,.06);display:grid;place-items:center}.rk-r:first-child em{background:var(--gold);color:var(--ink)}.rk-m{min-width:0}.rk-m span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rk-m i{display:block;height:5px;border-radius:3px;margin-top:5px;background:linear-gradient(90deg,#FFB800,#FFE55C);box-shadow:0 0 10px rgba(255,214,10,.4)}.rk-r b{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}.rk-r b span{display:block;font-size:11px;font-weight:500;color:var(--muted)}
@media(max-width:860px){.fn-row{grid-template-columns:96px 1fr 76px;gap:8px}.fn-drop{margin-left:104px}.hr{gap:2px}.hr.wd{gap:5px}}</style>`;
}

async function google(url) {
  const items = D.ACTIVE.flatMap((p) => p.variants.map((v) => ({ p, v })));
  const noGtin = items.filter((x) => !x.v.barcode).length;
  const noImg = D.ACTIVE.filter((p) => !p.images.length).length;
  const pre = D.ACTIVE.filter((p) => p.tags.includes('Pre-order')).length;
  const out = items.filter((x) => !x.v.available).length;
  const shortDesc = D.ACTIVE.filter((p) => p.description.replace(/<[^>]+>/g, '').length < 150).length;
  const label = process.env.GOOGLE_ADS_PURCHASE_LABEL || 'AW-18563400376/OnjQCMjFuLQdELiF3JNF, AW-18564361485/NbphCP-B6LQdEI3alpRF';
  const chk = (n, good = 'ok') => (n ? `<span class="pill warn">${n}</span>` : `<span class="pill ${good}">0</span>`);
  return `${head('Google Ads & Merchant Center', 'Product feed and conversion tracking of the shop.', '<a class="btn ghost sm" href="https://ads.google.com/aw/overview?ocid=8605942487" target="_blank" rel="noopener">Google Ads ↗</a> <a class="btn ghost sm" href="https://merchants.google.com/mc/overview?a=5874663349" target="_blank" rel="noopener">Merchant Center ↗</a>')}
<div class="grid g4"><div class="card kpi"><div class="l">Products in feed</div><div class="v">${items.length}</div></div><div class="card kpi"><div class="l">With EAN/GTIN</div><div class="v">${items.length - noGtin}</div><div class="d">${noGtin} without (sent as identifier_exists = no)</div></div><div class="card kpi"><div class="l">Pre-orders</div><div class="v">${pre}</div><div class="d">sent as “preorder” with date</div></div><div class="card kpi"><div class="l">Out of stock</div><div class="v">${out}</div><div class="d">sent as “out_of_stock”</div></div></div>
<div class="card"><h2>Feed</h2><p>Feed URL for Merchant Center (Products → Data sources → scheduled fetch, daily):</p><p><code>${esc(url.origin)}/feeds/google.xml</code> <a class="btn sm ghost" href="/feeds/google.xml" target="_blank">Open</a> &nbsp; <code>${esc(url.origin)}/feeds/google.txt</code> <span class="muted">(TSV)</span></p><p class="muted">Item IDs match the former Shopify feed (shopify_ZZ_…) so campaign history is preserved. Prices, stock and availability come live from this admin.</p></div>
<div class="grid g2"><div class="card"><h2>Feed quality</h2><table><tbody><tr><td>Products without image</td><td class="r">${chk(noImg)}</td></tr><tr><td>Very short descriptions (&lt; 150 chars)</td><td class="r">${chk(shortDesc)}</td></tr><tr><td>Legal pages (Impressum, AGB, Widerruf, Datenschutz, Versand)</td><td class="r"><span class="pill ok">✓</span></td></tr><tr><td>Contact: e-mail + address</td><td class="r"><span class="pill ok">✓</span></td></tr><tr><td>Shipping & return policy in Merchant Center</td><td class="r"><span class="pill ok">✓</span></td></tr></tbody></table></div>
<div class="card"><h2>Conversion tracking</h2><table><tbody><tr><td>Google tag</td><td class="r"><code>${esc((process.env.GOOGLE_TAG_IDS || 'AW-18563400376,AW-18564361485,MC-6HE5GH3QKM,MC-BJ8V6B473G').split(',').join(', '))}</code></td></tr><tr><td>Google Ads</td><td class="r"><code>AW-18563400376</code> · 772-980-6395<br><code>AW-18564361485</code> · 394-995-6856</td></tr><tr><td>Purchase conversion label</td><td class="r"><code>${esc(label)}</code></td></tr><tr><td>Events</td><td class="r muted">page_view, view_item, add_to_cart, begin_checkout, add_payment_info, purchase</td></tr><tr><td>Consent mode</td><td class="r"><span class="pill ok">active</span></td></tr></tbody></table><p class="muted">Each purchase is reported to the “Purchase” action of both Google Ads accounts: 772-980-6395 (luca.copper12) and 394-995-6856 (mauricelepaine).</p></div></div>`;
}

async function stripePage(url) {
  const s = checkout.getStripe();
  if (!s) return `${head('Stripe & payouts')}<div class="flash err">No Stripe secret key – add it in <a href="/admin/settings">Settings</a>.</div>`;
  let bal = null, pays = [], payouts = [], acct = null, whs = [];
  try { [bal, pays, payouts, acct, whs] = await Promise.all([s.balance.retrieve(), s.paymentIntents.list({ limit: 20 }), s.payouts.list({ limit: 8 }), s.accounts.retrieve(), s.webhookEndpoints.list({ limit: 20 })]); } catch (e) { return `${head('Stripe & payouts')}<div class="flash err">Stripe error: ${esc(e.message)}</div>`; }
  const avail = bal.available.find((b) => b.currency === 'eur') || { amount: 0 }; const pend = bal.pending.find((b) => b.currency === 'eur') || { amount: 0 };
  const cap = acct.capabilities || {};
  const types = await checkout.paymentMethodTypes();
  const secret = process.env.STRIPE_WEBHOOK_SECRET || (await stock.getSetting('stripe_webhook_secret'));
  const ours = whs.data.find((w) => w.url === `${url.origin}/api/stripe-webhook`);
  const last = await stock.getSetting('stripe_sync_last');
  const st = { succeeded: ['ok', 'paid'], processing: ['pending', 'processing'], requires_payment_method: ['pending', 'not paid'], canceled: ['warn', 'cancelled'], requires_action: ['pending', 'awaiting customer'], requires_confirmation: ['pending', 'not confirmed'] };
  const succ = pays.data.filter((p) => p.status === 'succeeded').length;
  const rel = ((await SS.releases(checkout.KEYS.sk)) || []).filter((r) => r.amount > 0); const nextRel = rel[0];
  return `${head('Stripe & payouts', `${esc(acct.settings && acct.settings.dashboard && acct.settings.dashboard.display_name)} · ${esc(acct.business_profile && acct.business_profile.name)} · ${checkout.isTestMode() ? '<span class="pill warn">TEST MODE</span>' : '<span class="pill ok">live mode</span>'}`, '<a class="btn ghost sm" href="https://dashboard.stripe.com" target="_blank" rel="noopener">Stripe dashboard ↗</a>')}
<div class="grid g4"><div class="card kpi"><div class="l">Available</div><div class="v">${money(avail.amount)}</div></div><div class="card kpi"><div class="l">Pending</div><div class="v">${money(pend.amount)}</div><div class="d">${nextRel ? `next: <b>${money(nextRel.amount)}</b> on ${esc(SS.relDate(nextRel.date))}` : 'released with the next payout'}</div></div><div class="card kpi"><div class="l">Last 20 payments</div><div class="v">${succ} <span class="muted" style="font-size:16px;font-weight:600">/ ${pays.data.length} paid</span></div><div class="d">${pays.data.length ? pct((succ / pays.data.length) * 100) + ' success rate' : ''}</div></div><div class="card kpi"><div class="l">Checkout methods</div><div class="v" style="font-size:15px;line-height:1.4">${types.map((t) => ({ card: 'Card · Apple Pay · Google Pay', klarna: 'Klarna', paypal: 'PayPal', amazon_pay: 'Amazon Pay' })[t]).join('<br>')}</div><div class="d">${cap.amazon_pay_payments !== 'active' ? 'Amazon Pay: enable in Stripe → appears automatically' : ''}${cap.paypal_payments !== 'active' ? ' · PayPal: same' : ''}</div></div></div>
<div class="card tight"><h2>When pending money becomes available</h2><table><thead><tr><th>Available on</th><th class="r">Amount (after fees)</th><th>Status</th></tr></thead><tbody>${rel.map((r, i) => `<tr><td class="num"><b>${esc(SS.relDate(r.date))}</b> <span class="muted">${esc(r.date)}</span></td><td class="r"><b>${money(r.amount)}</b></td><td><span class="pill ${i === 0 ? 'paid' : 'pending'}">${i === 0 ? 'next' : 'pending'}</span></td></tr>`).join('') || empty('Nothing pending right now – everything is already available.', 3)}</tbody></table><p class="muted" style="margin:10px 14px">Once money is available, Stripe pays it out to your bank on your payout schedule (see Payouts below).</p></div>
<div class="grid g2"><div class="card"><h2>Payment sync</h2><p class="muted">Without a webhook, paid payments are picked up from Stripe here and automatically once a day (in case a customer never reached the thank-you page).${last ? ` Last sync: ${dt(last)}.` : ''}</p><form method="post" action="/admin/stripe/sync"><button class="btn ghost" type="submit">Sync with Stripe now</button></form></div>
<div class="card"><h2>Webhook <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">(recommended)</span></h2>${ours && secret ? `<p><span class="pill ok">configured</span> ${esc(ours.url)} · status ${esc(ours.status)}</p>` : `<p><span class="pill warn">not configured</span> Without a webhook, orders are only processed when the customer reaches the thank-you page, and refunds made in Stripe aren’t picked up.</p><form method="post" action="/admin/stripe/webhook"><button class="btn" type="submit">Set up webhook automatically</button></form>`}</div></div>
<div class="grid g32"><div class="card tight"><h2>Recent payments</h2><table><thead><tr><th>Date</th><th>Customer</th><th class="r">Amount</th><th>Status</th><th></th></tr></thead><tbody>${pays.data.map((p) => { const [c, l] = st[p.status] || ['pending', p.status]; return `<tr><td class="num">${dt(p.created * 1000)}</td><td>${esc((p.metadata && p.metadata.email) || (p.shipping && p.shipping.name) || '')}</td><td class="r">${money(p.amount)}</td><td><span class="pill ${c}">${l}</span></td><td><a href="https://dashboard.stripe.com/payments/${p.id}" target="_blank" rel="noopener">↗</a></td></tr>`; }).join('') || empty('No payments yet.', 5)}</tbody></table></div>
<div class="card tight"><h2>Payouts</h2><table><thead><tr><th>Arrives</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>${payouts.data.map((p) => `<tr><td class="num">${dd(p.arrival_date * 1000)}</td><td class="r">${money(p.amount)}</td><td><span class="pill ${p.status === 'paid' ? 'ok' : 'pending'}">${p.status === 'paid' ? 'paid out' : p.status}</span></td></tr>`).join('') || empty('No payouts yet.', 3)}</tbody></table></div></div>`;
}

const stripeBalance = (sk) => SS.balance(sk);
async function settings(url) {
  const s = await stock.allSettings(true);
  const env = (k) => (process.env[k] ? '<span class="pill ok">set</span>' : '<span class="pill warn">missing</span>');
  const K = checkout.KEYS; const mask = (k) => (k ? `${k.slice(0, 8)}…${k.slice(-4)}` : '');
  const active = s.stripe_active || '';
  let slots = []; try { slots = JSON.parse(s.stripe_slots || '[]'); } catch (e) { slots = []; }
  const recheck = !!(url && url.searchParams && url.searchParams.get('recheck'));
  const [bals, hs, rels] = await Promise.all([Promise.all(slots.map((x) => stripeBalance(x.sk))), Promise.all(slots.map((x) => SS.health(x.sk, recheck))), Promise.all(slots.map((x) => SS.releases(x.sk)))]);
  const capChip = (n, st) => `<span class="hc ${st === 'active' ? 'y' : st === 'pending' ? 'p' : 'n'}">${st === 'active' ? '✓' : st === 'pending' ? '…' : '✕'} ${n}</span>`;
  const healthHtml = (h) => { if (!h) return '';
    if (!h.ok) return `<div class="hl hl-unknown"><div class="hl-h"><span class="hl-b">❔ Status unknown</span><span class="muted">${esc(h.error)}</span></div></div>`;
    return `<div class="hl hl-${h.state}"><div class="hl-h"><span class="hl-b">${h.emoji} ${esc(h.label)}</span>${h.reason ? `<span class="hl-r">${esc(h.reason)}</span>` : ''}${h.deadline ? `<span class="hl-d">⏰ due ${esc(SS.dDate(h.deadline))}</span>` : ''}<span class="hl-t muted">checked ${esc(dt(h.checked))} · <a href="/admin/settings?recheck=1">re-check</a></span></div>
<div class="hl-c"><span class="hc ${h.charges ? 'y' : 'n'}">${h.charges ? '✓' : '✕'} Payments</span><span class="hc ${h.payouts ? 'y' : 'n'}">${h.payouts ? '✓' : '✕'} Payouts</span>${capChip('Card', h.card)}${capChip('Klarna', h.klarna)}${capChip('Amazon Pay', h.amazon)}${h.country ? `<span class="hc">${esc(h.country)}</span>` : ''}</div>
${h.due.length ? `<div class="hl-l"><b>Stripe needs:</b><ul>${h.due.slice(0, 8).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}${h.errors.length ? `<div class="hl-l hl-err">${h.errors.map((e) => `<div>❗ ${esc(e)}</div>`).join('')}</div>` : ''}${h.reviewing.length ? `<div class="hl-l muted">⏳ In review: ${esc(h.reviewing.join(', '))}</div>` : ''}${h.later.length ? `<div class="hl-l muted">🕒 Later: ${esc(h.later.slice(0, 6).join(', '))}</div>` : ''}${h.state !== 'active' ? `<a class="btn sm hl-go" href="${esc(h.link)}" target="_blank" rel="noopener">Fix in Stripe ↗</a>` : ''}</div>`; };
  const slotHtml = (x, i) => { const on = active === x.id, has = !!(x.sk && x.pk), bal = bals[i], rel = (rels[i] || []).filter((r) => r.amount > 0);
    return `<div class="slot${on ? ' on' : ''}"><div class="slot-h"><div><form method="post" action="/admin/settings/stripe" class="nm"><input type="hidden" name="slot" value="${esc(x.id)}"><input name="name" value="${esc(x.name || '')}" placeholder="Name (e.g. Main, Backup)" maxlength="40"><button class="btn ghost sm" type="submit" name="rename" value="1" title="Save name">✓</button></form><div class="muted" style="font-size:12px;margin-top:4px">${x.acct ? `${esc(x.acct)} · ` : ''}${has ? `${esc(mask(x.pk))} / ${esc(mask(x.sk))}` : 'no keys yet'}${x.sk && x.sk.startsWith('sk_test') ? ' · <span class="pill warn">test</span>' : ''}${x.lastTest ? ` · <span class="pill ${x.lastTest.ok ? 'ok' : 'refunded'}" title="${esc(x.lastTest.msg)}">${x.lastTest.ok ? '✓ tested' : '✗ test failed'} ${esc(dt(x.lastTest.at))}</span>` : ''}</div></div>
<div style="text-align:right"><form method="post" action="/admin/settings/stripe" style="margin:0 0 6px"><input type="hidden" name="slot" value="${esc(x.id)}"><button class="toggle ${on ? 'is-on' : ''}" type="submit" name="toggle" value="${on ? 'off' : 'on'}"${has || on ? '' : ' disabled'}><i></i><span>${on ? 'ON' : 'OFF'}</span></button></form>${bal ? `<div class="bal"><b>${money(bal.available)}</b> available<div class="muted">${money(bal.pending)} pending</div>${rel.length ? `<div class="rel">${rel.slice(0, 4).map((r) => `<div>🗓 <b>${money(r.amount)}</b> on ${esc(SS.relDate(r.date))}</div>`).join('')}${rel.length > 4 ? `<div class="muted">+ ${rel.length - 4} more days</div>` : ''}</div>` : ''}</div>` : has ? '<div class="bal muted">balance unavailable</div>' : ''}</div></div>
${healthHtml(hs[i])}<form method="post" action="/admin/settings/stripe"><input type="hidden" name="slot" value="${esc(x.id)}"><div class="grid g2" style="gap:10px"><div><label>Publishable key</label><input name="stripe_pk" value="" placeholder="${x.pk ? 'leave empty to keep' : 'pk_live_…'}" autocomplete="off"></div><div><label>Secret key</label><input name="stripe_sk" type="password" value="" placeholder="${x.sk ? 'leave empty to keep' : 'sk_live_…'}" autocomplete="new-password"></div></div><div style="height:10px"></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" type="submit">Save &amp; verify</button> <button class="btn ghost sm" type="submit" formaction="/admin/settings/stripe-test" name="test" value="1"${has ? '' : ' disabled'} title="1 € Klarna test intent on THIS account’s keys, checks the redirect, then cancels – nothing charged">🧪 Test checkout</button> <button class="btn ghost sm" type="submit" name="remove" value="1" onclick="return confirm('Remove this Stripe account from the panel?')">Remove</button></div></form></div>`; };
  const stripeCard = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0">Stripe accounts</h2><form method="post" action="/admin/settings/stripe" style="margin:0"><button class="btn sm" type="submit" name="add" value="1">+ Add Stripe</button></form></div><p class="muted">Each account has its own key pair; the switch decides which one takes payments (only one at a time). Both keys must come from the same Stripe account. Changes apply within 30 s – no redeploy. ${K.slot !== 'env' ? `Currently <b>${esc(K.slotName || K.slot)}</b> is on.` : 'All off → the Vercel environment keys are used.'}</p>
<style>.rel{font-size:11.5px;line-height:1.55;margin-top:4px;color:var(--text)}.slot{border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:10px;background:rgba(255,255,255,.025)}.slot.on{border-color:rgba(52,211,153,.6);background:rgba(52,211,153,.07);box-shadow:0 0 0 1px rgba(52,211,153,.25),0 10px 30px -14px rgba(52,211,153,.5)}.slot-h{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px}.slot .nm{display:flex;gap:6px;margin:0}.slot .nm input{font-weight:700;width:220px;padding:6px 10px}.toggle{display:inline-flex;align-items:center;gap:8px;border:0;background:none;cursor:pointer;font:inherit;font-weight:700;font-size:12px;color:var(--muted)}.toggle i{width:40px;height:22px;border-radius:999px;background:rgba(255,255,255,.16);position:relative;transition:.2s}.toggle i:after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 2px rgba(0,0,0,.2)}.toggle.is-on i{background:#34D399;box-shadow:0 0 12px rgba(52,211,153,.7)}.toggle.is-on i:after{left:21px}.toggle.is-on{color:var(--green)}.toggle:disabled{opacity:.4;cursor:not-allowed}.bal{font-size:12.5px;white-space:nowrap}.bal b{font-size:15px}
.hl{border-radius:10px;padding:10px 12px;margin:0 0 12px;border:1px solid;font-size:13px}.hl-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.hl-b{font-weight:800;font-size:13.5px}.hl-r{font-weight:600}.hl-d{background:rgba(0,0,0,.25);border-radius:999px;padding:2px 9px;font-weight:700;font-size:12px;border:1px solid currentColor}.hl-t{margin-left:auto;font-size:11.5px}.hl-c{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.hc{font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid var(--line);color:var(--muted)}.hc.y{color:var(--green);border-color:rgba(52,211,153,.3);background:var(--green-bg)}.hc.n{color:var(--red);border-color:rgba(248,113,113,.3);background:var(--red-bg)}.hc.p{color:var(--amber);border-color:rgba(251,191,36,.3);background:var(--amber-bg)}.hl-l{margin-top:8px}.hl-l ul{margin:4px 0 0 18px;padding:0}.hl-l li{margin:2px 0}.hl-err{color:var(--red)}.hl-go{margin-top:10px}
.hl-active{background:var(--green-bg);border-color:rgba(52,211,153,.3);color:#A7F3D0}.hl-soon{background:var(--blue-bg);border-color:rgba(96,165,250,.3);color:#BFDBFE}.hl-review{background:var(--amber-bg);border-color:rgba(251,191,36,.3);color:#FDE68A}.hl-action{background:rgba(251,146,60,.13);border-color:rgba(251,146,60,.35);color:#FDBA74}.hl-restricted{background:var(--red-bg);border-color:rgba(248,113,113,.35);color:#FECACA}.hl-unknown{background:rgba(255,255,255,.04);border-color:var(--line);color:var(--muted)}</style>
${slots.map(slotHtml).join('') || '<p class="muted">No Stripe accounts yet – click “+ Add Stripe”.</p>'}</div>`;
  const deployCard = `<div class="card"><h2>Deploy</h2><p class="muted" style="margin-top:0">Rebuilds and redeploys the shop on Vercel (~20 s). Needs a Deploy Hook URL: Vercel → Project → Settings → Git → Deploy Hooks → Create (name “admin”, branch “main”) → paste below.</p><form method="post" action="/admin/settings/deploy"><label>Vercel deploy hook URL</label><input name="deploy_hook" value="${esc(s.deploy_hook || '')}" placeholder="https://api.vercel.com/v1/integrations/deploy/…"><div style="height:14px"></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" type="submit" name="save" value="1">Save URL</button> <button class="btn" type="submit" name="deploy" value="1"${s.deploy_hook ? '' : ' disabled'}>🚀 Deploy now</button></div></form>${s.last_deploy ? `<p class="muted" style="margin-bottom:0">Last deploy triggered: ${esc(dt(s.last_deploy))}</p>` : ''}</div>`;
  const db = await stock.dbUsage();
  const tg = await tgpanel.status().catch((e) => ({ connected: false, text: e.message }));
  const tgCard = `<div class="card"><h2>Telegram panel <span class="pill ${tg.connected ? 'ok' : 'warn'}" style="margin-left:6px">${tg.connected ? 'connected' : 'off'}</span></h2><p class="muted" style="margin-top:0">The Stripe accounts card as a Telegram bot: switch accounts, see balances, test Klarna, add/rename/remove profiles, deploy, today’s stats – all with buttons. Create a bot with @BotFather, paste its token, add your Telegram user ID (the bot tells you yours with /id), then click <b>Connect</b>.</p>
<form method="post" action="/admin/settings/tgpanel"><label>Panel bot token <span class="muted">(can be the same bot as the notifications)</span></label><input name="tg_panel_token" value="${esc(s.tg_panel_token || '')}" placeholder="123456:ABC…" autocomplete="off"><div style="height:10px"></div><label>Allowed Telegram user IDs <span class="muted">(comma-separated; the notifications chat ID is always allowed)</span></label><input name="tg_panel_admins" value="${esc(s.tg_panel_admins || '')}" placeholder="e.g. 123456789, 987654321"><div style="height:14px"></div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn ghost" type="submit" name="save" value="1">Save</button> <button class="btn" type="submit" name="connect" value="1">🔗 Connect</button> ${tg.connected ? `<button class="btn ghost" type="submit" name="disconnect" value="1">Disconnect</button> <a class="btn ghost" href="https://t.me/${esc(tg.username)}" target="_blank" rel="noopener">Open @${esc(tg.username)} ↗</a>` : ''}</div></form><p class="muted" style="margin-bottom:0">${esc(tg.text)}</p></div>`;
  return `${head('Settings', 'Everything on this page takes effect immediately.')}
<div class="grid g2">${stripeCard}<div>${deployCard}${tgCard}</div></div>
<div class="grid g2"><div class="card"><h2>Notifications</h2><form method="post" action="/admin/settings"><label>Order e-mails to</label><input name="owner_email" value="${esc(s.owner_email || OWNER)}"><div style="height:10px"></div><label>Telegram bot token <span class="muted">(from @BotFather)</span></label><input name="telegram_token" value="${esc(s.telegram_token || '')}" placeholder="123456:ABC…"><div style="height:10px"></div><label>Telegram chat ID <span class="muted">(send the bot “/start”, then click “Detect chat ID”)</span></label><input name="telegram_chat" value="${esc(s.telegram_chat || '')}" placeholder="e.g. 123456789"><div style="height:10px"></div><label>Abandoned-cart reminder after (hours, 0 = off)</label><input name="reminder_hours" type="number" min="0" value="${esc(s.reminder_hours || '2')}"><div style="height:14px"></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">Save</button> <button class="btn ghost" type="submit" name="test" value="chatid">Detect chat ID</button> <button class="btn ghost" type="submit" name="test" value="telegram">Test Telegram</button> <button class="btn ghost" type="submit" name="test" value="mail">Send test e-mail</button></div></form></div>
<div class="card"><h2>System</h2><table><tbody>${db ? `<tr><td>Database <span class="muted">(Upstash Redis${db.host ? ` · ${esc(db.host)}` : ''})</span></td><td class="r">${db.error ? `<span class="pill warn">${esc(db.error)}</span>` : `<span class="pill ok">${num(db.keys)} keys · ${db.mem ? `${(db.mem / 1048576).toFixed(2)} MB` : esc(db.memHuman || '?')} used</span>`}</td></tr>` : ''}<tr><td>Stripe secret key</td><td class="r">${K.sk ? `<span class="pill ok">${K.slot === 'env' ? 'Vercel env' : `Stripe ${K.slot.toUpperCase()}`} · ${esc(mask(K.sk))}</span>` : '<span class="pill warn">missing</span>'}</td></tr><tr><td>Stripe publishable key</td><td class="r">${K.pk ? `<span class="pill ok">${esc(mask(K.pk))}</span>` : '<span class="pill warn">missing</span>'}</td></tr><tr><td>Stripe sync</td><td class="r"><span class="pill ok">automatic (daily + on demand)</span></td></tr><tr><td>Resend (e-mails)</td><td class="r">${env('RESEND_API_KEY')}</td></tr><tr><td>Database (Upstash Redis)</td><td class="r">${stock.enabled() ? '<span class="pill ok">connected</span>' : '<span class="pill warn">missing</span>'}</td></tr><tr><td>Sender</td><td class="r">${esc(require('./brand').mailFrom)}</td></tr><tr><td>Google Ads purchase label</td><td class="r"><code>${esc(process.env.GOOGLE_ADS_PURCHASE_LABEL || 'default')}</code></td></tr></tbody></table><p class="muted">The admin password, Resend and Redis keys live in Vercel → Settings → Environment Variables.</p></div></div>`;
}

// ------------------------------------------------------------------ actions
async function act(req, res, url, path, readBody) {
  const b = await readBody(req);
  let m;
  if ((m = /^\/admin\/live\/visitor\/([a-z0-9]+)\/(timeout|untimeout)$/i.exec(path))) {
    const back = `/admin/live/visitor/${m[1]}`;
    if (m[2] === 'timeout') { const r = await stock.setTimeoutFor(m[1], b.minutes, b.reason); stock.logActivity('timeout', `Visitor ${m[1]} paused for ${r ? r.minutes : '?'} min${b.reason ? ` · ${String(b.reason).slice(0, 80)}` : ''}`, { href: back }); return redirect(res, `${back}?f=${encodeURIComponent(`Visitor paused for ${r ? r.minutes : '?'} minutes.`)}`); }
    await stock.clearTimeoutFor(m[1]); stock.logActivity('timeout', `Time-out lifted for visitor ${m[1]}`, { href: back }); return redirect(res, `${back}?f=${encodeURIComponent('Time-out lifted.')}`);
  }
  if ((m = /^\/admin\/orders\/([^/]+)\/(ship|note|resend|cancel|refund|restock)$/.exec(path))) {
    const o = await stock.getOrder(decodeURIComponent(m[1]));
    if (!o) return layout(res, { title: 'Not found', body: '<div class="card">Order not found.</div>', status: 404 });
    const back = `/admin/orders/${encodeURIComponent(o.id)}`;
    const site = url.origin;
    if (m[2] === 'ship') {
      const carrier = CARRIERS[b.carrier] ? b.carrier : 'Posti'; const tracking = String(b.tracking || '').trim();
      Object.assign(o, { status: 'shipped', carrier, tracking, shippedAt: o.shippedAt || new Date().toISOString() });
      await stock.saveOrder(o);
      const mail = T.shippingConfirmation(o, site, { carrier, tracking, trackingUrl: tracking ? CARRIERS[carrier](tracking) : '' });
      const ok = o.email ? await send({ to: o.email, subject: mail.subject, html: mail.html, tags: [{ name: 'type', value: 'shipping' }] }) : false;
      await stock.addEvent(o.id, 'shipped', `Shipped (${carrier} ${tracking})${ok ? ' – shipping confirmation sent' : ' – e-mail NOT sent'}`);
      stock.logActivity('ship', `${o.number} shipped · ${carrier} ${tracking}`, { href: back, who: o.name || o.email });
      return redirect(res, `${back}?f=${encodeURIComponent(ok ? 'Shipping confirmation sent to the customer.' : '!Saved, but the e-mail could not be sent (check RESEND_API_KEY).')}`);
    }
    if (m[2] === 'note') { if (b.text) await stock.addEvent(o.id, 'note', `Note: ${String(b.text).slice(0, 500)}`); return redirect(res, back); }
    if (m[2] === 'resend') {
      const mail = T.orderConfirmation(o, site);
      const ok = await send({ to: o.email, subject: mail.subject, html: mail.html, attachments: legalAttachment(), tags: [{ name: 'type', value: 'order_confirmation' }] });
      await stock.addEvent(o.id, 'mail', ok ? 'Order confirmation resent' : 'Resending failed');
      return redirect(res, `${back}?f=${encodeURIComponent(ok ? 'Order confirmation resent.' : '!E-mail could not be sent.')}`);
    }
    if (m[2] === 'cancel') {
      o.status = 'cancelled'; o.cancelledAt = new Date().toISOString(); o.restocked = true;
      await stock.saveOrder(o); await stock.recordSale(o.lines.map((l) => ({ id: l.id, quantity: -l.quantity })));
      await stock.addEvent(o.id, 'cancelled', 'Cancelled, items returned to stock (no refund triggered)');
      stock.logActivity('cancel', `${o.number} cancelled`, { href: back, who: o.name || o.email });
      return redirect(res, `${back}?f=${encodeURIComponent('Order cancelled and stock restored. Trigger a refund separately if needed.')}`);
    }
    if (m[2] === 'refund') {
      const s = checkout.getStripe();
      try {
        const r = await s.refunds.create({ payment_intent: o.id, reason: 'requested_by_customer' });
        o.refundedCents = (o.refundedCents || 0) + r.amount; o.refundedAt = new Date().toISOString(); if (o.refundedCents >= o.total) o.status = 'refunded';
        await stock.saveOrder(o); await stock.addEvent(o.id, 'refund', `Refund via Stripe: ${money(r.amount)} (from the admin)`);
        stock.logActivity('refund', `${o.number} refunded · ${money(r.amount)}`, { href: back, who: o.name || o.email, amount: r.amount });
        return redirect(res, `${back}?f=${encodeURIComponent(`${money(r.amount)} refunded.`)}`);
      } catch (e) { return redirect(res, `${back}?f=${encodeURIComponent(`!Refund failed: ${e.message}`)}`); }
    }
    if (m[2] === 'restock') {
      o.restocked = true; await stock.saveOrder(o); await stock.recordSale(o.lines.map((l) => ({ id: l.id, quantity: -l.quantity })));
      await stock.addEvent(o.id, 'restock', 'Items returned to stock');
      return redirect(res, `${back}?f=${encodeURIComponent('Stock restored.')}`);
    }
  }
  if (path === '/admin/orders/abandoned/remind') {
    const c = await stock.getCart(String(b.token || ''));
    if (c) { const ok = await sendReminder(c, url.origin); return redirect(res, `/admin/orders/abandoned?f=${encodeURIComponent(ok ? `Reminder sent to ${c.email}.` : '!E-mail could not be sent.')}`); }
    return redirect(res, '/admin/orders/abandoned');
  }
  if ((m = /^\/admin\/products\/([^/]+)\/variant\/(\d+)$/.exec(path))) {
    const p = D.productByHandle(m[1]); const v = p && p.variants.find((x) => String(x.id) === m[2]);
    if (!v) return redirect(res, '/admin/products');
    const before = v.inventory_quantity, priceBefore = v.price;
    const qty = Math.max(0, parseInt(b.stock, 10) || 0);
    const raw = String(b.price || '').trim(); const price = Math.round(parseFloat(/,\d{1,2}$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '')) * 100);
    await stock.setStock(v.id, qty);
    if (Number.isFinite(price) && price > 0) await stock.setPrice(v.id, price === v.base_price ? null : price);
    let note = `stock ${qty}, price ${money(v.price)}`;
    if (before !== qty || priceBefore !== v.price) stock.logActivity('stock', `${p.title}: ${before !== qty ? `stock ${before} → ${qty}` : ''}${before !== qty && priceBefore !== v.price ? ', ' : ''}${priceBefore !== v.price ? `price ${money(priceBefore)} → ${money(v.price)}` : ''}`, { href: `/admin/products/${p.handle}` });
    if (before <= 0 && qty > 0) { const n = await notifyBackInStock(p, v, url.origin); if (n) note += ` · ${n} waitlist e-mail(s) sent`; }
    const back = String(b.back || ''); const to = /^\/admin\/products(\?[^\s]*)?$/.test(back) ? back : `/admin/products/${p.handle}`;
    return redirect(res, `${to}${to.includes('?') ? '&' : '?'}f=${encodeURIComponent(`Saved ${p.title}: ${note}.`)}`);
  }
  if (path === '/admin/settings/stripe') {
    const back = '/admin/settings';
    const out = (r) => { checkout.refreshKeys(true).catch(() => {}); return redirect(res, `${back}?f=${encodeURIComponent(r.ok ? r.msg : `!${r.error}`)}`); };
    if (b.add) { await SS.add(''); return out({ ok: true, msg: 'New Stripe slot added – paste its keys and give it a name.' }); }
    const id = String(b.slot || '');
    if (b.rename) return out(await SS.rename(id, b.name));
    if (b.toggle) return out(await SS.toggle(id, b.toggle === 'on', 'Admin'));
    if (b.remove) return out(await SS.remove(id));
    return out(await SS.setKeys(id, b.stripe_sk, b.stripe_pk));
  }
  if (path === '/admin/settings/stripe-test') {
    const r = await SS.test(String(b.slot || ''), url.origin, 'Admin');
    return redirect(res, `/admin/settings?f=${encodeURIComponent(r.ok ? `✅ ${r.msg} Telegram sent.` : `!${r.slot ? r.slot.name : 'Stripe'}: test failed – ${r.error}`)}`);
  }
  if (path === '/admin/settings/tgpanel') {
    const back = '/admin/settings';
    if (b.disconnect) { const r = await tgpanel.disconnect(); return redirect(res, `${back}?f=${encodeURIComponent(r.msg)}`); }
    if ('tg_panel_token' in b) await stock.setSetting('tg_panel_token', String(b.tg_panel_token || '').trim());
    if ('tg_panel_admins' in b) await stock.setSetting('tg_panel_admins', String(b.tg_panel_admins || '').replace(/[^\d,\s]/g, '').split(/[,\s]+/).filter(Boolean).join(','));
    if (b.connect) { const r = await tgpanel.connect(url.origin); return redirect(res, `${back}?f=${encodeURIComponent(r.ok ? `✅ ${r.msg}` : `!${r.error}`)}`); }
    return redirect(res, `${back}?f=${encodeURIComponent('Telegram panel settings saved.')}`);
  }
  if (path === '/admin/settings/deploy') {
    const back = '/admin/settings';
    const hook = String(b.deploy_hook || '').trim();
    if (b.save || (hook && hook !== (await stock.getSetting('deploy_hook')))) {
      if (hook && !/^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\//.test(hook)) return redirect(res, `${back}?f=${encodeURIComponent('!That does not look like a Vercel deploy hook URL.')}`);
      await stock.setSetting('deploy_hook', hook);
      if (!b.deploy) return redirect(res, `${back}?f=${encodeURIComponent(hook ? 'Deploy hook saved.' : 'Deploy hook removed.')}`);
    }
    if (b.deploy) { const r = await SS.deploy('Admin'); return redirect(res, `${back}?f=${encodeURIComponent(r.ok ? `🚀 ${r.msg}` : `!${r.error}`)}`); }
    return redirect(res, back);
  }
  if (path === '/admin/settings') {
    for (const k of ['owner_email', 'telegram_token', 'telegram_chat', 'reminder_hours']) await stock.setSetting(k, String(b[k] || '').trim());
    if (b.test === 'chatid') {
      const token = String(b.telegram_token || '').trim();
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=100`); const j = await r.json();
        const msgs = ((j && j.result) || []).map((u) => (u.message || u.channel_post || u.my_chat_member || {}).chat).filter(Boolean);
        const chat = msgs[msgs.length - 1];
        if (!chat) return redirect(res, `/admin/settings?f=${encodeURIComponent('!No message has reached the bot yet. Open the bot in Telegram, send /start, then click again.')}`);
        await stock.setSetting('telegram_chat', String(chat.id));
        const ok = await telegram.notify('✅ Kylpymaailma Admin is connected. New orders, withdrawals and payment problems will arrive here.');
        return redirect(res, `/admin/settings?f=${encodeURIComponent(ok ? `Chat ID ${chat.id} saved – test message sent.` : `!Chat ID ${chat.id} saved, but sending failed – check the token.`)}`);
      } catch (e) { return redirect(res, `/admin/settings?f=${encodeURIComponent(`!Telegram error: ${e.message}`)}`); }
    }
    if (b.test === 'telegram') { const ok = await telegram.notify('✅ Kylpymaailma Admin: Telegram notifications are working.'); return redirect(res, `/admin/settings?f=${encodeURIComponent(ok ? 'Telegram message sent.' : '!Telegram test failed – check token/chat ID.')}`); }
    if (b.test === 'mail') { const to = String(b.owner_email || OWNER); const ok = await send({ to, subject: 'Test – Kylpymaailma Admin', html: '<p>The e-mail connection via Resend is working.</p>' }); return redirect(res, `/admin/settings?f=${encodeURIComponent(ok ? `Test e-mail sent to ${to}.` : '!E-mail failed – check RESEND_API_KEY.')}`); }
    return redirect(res, `/admin/settings?f=${encodeURIComponent('Settings saved.')}`);
  }
  if (path === '/admin/stripe/sync') {
    try { const n = await checkout.syncFromStripe(url.origin); return redirect(res, `/admin/stripe?f=${encodeURIComponent(n ? `${n} order(s) imported from Stripe.` : 'Everything is up to date – no missing orders.')}`); }
    catch (e) { return redirect(res, `/admin/stripe?f=${encodeURIComponent(`!Sync failed: ${e.message}`)}`); }
  }
  if (path === '/admin/stripe/webhook') {
    const s = checkout.getStripe();
    try {
      const ep = await s.webhookEndpoints.create({ url: `${url.origin}/api/stripe-webhook`, enabled_events: ['payment_intent.succeeded', 'payment_intent.payment_failed', 'charge.refunded'], description: 'Kylpymaailma Shop' });
      await stock.setSetting('stripe_webhook_secret', ep.secret);
      return redirect(res, `/admin/stripe?f=${encodeURIComponent('Webhook set up.')}`);
    } catch (e) { return redirect(res, `/admin/stripe?f=${encodeURIComponent(`!Webhook could not be created: ${e.message}`)}`); }
  }
  return redirect(res, '/admin');
}

async function sendReminder(c, origin) {
  const m = T.cartReminder(c, origin);
  const ok = await send({ to: c.email, subject: m.subject, html: m.html, headers: { 'List-Unsubscribe': `<${origin}/newsletter/unsubscribe?e=${encodeURIComponent(c.email)}&t=${c.unsub}>` }, tags: [{ name: 'type', value: 'cart_reminder' }] });
  if (ok) { c.reminded = new Date().toISOString(); await stock.saveCart(c.token, c); stock.logActivity('reminder', `Cart reminder sent · ${money(c.total)}`, { who: c.email, href: '/admin/orders/abandoned' }); }
  return ok;
}
async function notifyBackInStock(p, v, origin) {
  const emails = await stock.takeBackInStock(v.id);
  let n = 0;
  for (const e of emails) { const m = T.backInStock(p, origin); if (await send({ to: e, subject: m.subject, html: m.html, tags: [{ name: 'type', value: 'back_in_stock' }] })) n++; }
  return n;
}
// runs at most every 10 minutes (called from normal traffic): abandoned-cart reminders
async function cron(origin) {
  if (!stock.enabled()) return;
  if (!(await stock.redis(['SET', 'tw:cron', '1', 'NX', 'EX', '600']))) return;
  await checkout.syncFromStripe(origin).catch(() => {});
  const hours = Number(await stock.getSetting('reminder_hours', '2'));
  if (!hours) return;
  for (const c of await stock.listCarts()) {
    if (c.reminded) continue;
    if (Date.now() - new Date(c.at).getTime() < hours * 3600e3) continue;
    const customers = await stock.listCustomers();
    if (customers.some((x) => x.email === c.email && x.list.some((o) => new Date(o.created) > new Date(c.at)))) { await stock.deleteCart(c.token); continue; }
    await sendReminder(c, origin).catch(() => {});
  }
}

function csv(res, rows, name) {
  res.statusCode = 200; res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.end(`﻿${rows.map((r) => r.map((x) => `"${String(x === undefined || x === null ? '' : x).replace(/"/g, '""')}"`).join(';')).join('\r\n')}`);
}

// ------------------------------------------------------------------ router
async function handle(req, res, url, readBody) {
  const path = url.pathname;
  if (!process.env.ADMIN_PASSWORD) return layout(res, { title: 'Admin', body: '<div class="card">The admin isn’t set up yet: add the <b>ADMIN_PASSWORD</b> environment variable in Vercel.</div>', status: 503 });
  if (path === '/admin/login' && req.method === 'POST') {
    const b = await readBody(req);
    const h = (x) => crypto.createHash('sha256').update(String(x || '')).digest();
    if (b.password && crypto.timingSafeEqual(h(b.password), h(process.env.ADMIN_PASSWORD))) { res.setHeader('Set-Cookie', `${COOKIE}=${tokenFor()}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`); return redirect(res, '/admin'); }
    return layout(res, { title: 'Sign in', body: loginForm('Wrong password.'), status: 401 });
  }
  if (path === '/admin/logout') { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/admin; Max-Age=0`); return redirect(res, '/admin'); }
  if (!authed(req)) { if (path === '/admin/api/live') { res.statusCode = 401; return res.end('{}'); } return layout(res, { title: 'Sign in', body: loginForm(), status: 401 }); }
  if (!stock.enabled()) return layout(res, { title: 'Admin', body: '<div class="card">Orders and settings are stored in Upstash Redis. Connect an Upstash Redis database to the project in Vercel → Storage.</div>', status: 503 });
  await stock.load();
  if (req.method === 'POST') return act(req, res, url, path, readBody);
  if (path === '/admin/api/live') { const data = await liveData(url.searchParams.get('tr')); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); return res.end(JSON.stringify({ html: await liveFragment(data), visitors: mapPoints(data.sessions), at: new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' }) })); }
  const flash = url.searchParams.get('f') || '';
  const page = (title, body, status = 200) => layout(res, { title, body, status, path, flash });
  let m;
  if (path === '/admin') return page('Dashboard', await dashboard());
  if (path === '/admin/live') return page('Live', await livePage());
  if ((m = /^\/admin\/live\/visitor\/([a-z0-9]+)$/i.exec(path))) { const b = await visitorPage(m[1]); return b ? page('Visitor', b) : page('Not found', '<div class="card">This visitor session has expired (sessions are kept for 3 hours).</div>', 404); }
  if (path === '/admin/orders') return page('Orders', await ordersList(url));
  if (path === '/admin/orders/abandoned') return page('Abandoned carts', await abandoned());
  if (path === '/admin/orders/export.csv') { const os = await stock.listOrders(2000); return csv(res, [['Order', 'Date', 'Status', 'Name', 'E-mail', 'Street', 'ZIP', 'City', 'Items', 'Total', 'Payment', 'Tracking'], ...os.map((o) => [o.number, dt(o.created), (STATUS[o.status] || [o.status])[0], o.name, o.email, [o.address && o.address.line1, o.address && o.address.line2].filter(Boolean).join(', '), o.address && o.address.postal_code, o.address && o.address.city, o.lines.map((l) => `${l.quantity}x ${l.title}`).join(' | '), (o.total / 100).toFixed(2), o.paymentLabel, o.tracking])], 'orders.csv'); }
  if ((m = /^\/admin\/orders\/([^/]+)$/.exec(path))) { const b = await orderDetail(decodeURIComponent(m[1])); return b ? page('Order', b) : page('Not found', '<div class="card">Order not found.</div>', 404); }
  if (path === '/admin/products') return page('Products', await products(url));
  if ((m = /^\/admin\/products\/([^/]+)$/.exec(path))) { const b = await productEdit(m[1]); return b ? page('Product', b) : page('Not found', '<div class="card">Product not found.</div>', 404); }
  if (path === '/admin/customers') return page('Customers', await customers(url));
  if (path === '/admin/customers/export.csv') { const cs = await stock.listCustomers(); return csv(res, [['E-mail', 'Name', 'City', 'Orders', 'Revenue', 'Last order'], ...cs.map((c) => [c.email, c.name, c.city, c.orders, (c.revenue / 100).toFixed(2), dd(c.last)])], 'customers.csv'); }
  if ((m = /^\/admin\/customers\/([^/]+)$/.exec(path))) { const b = await customerDetail(decodeURIComponent(m[1])); return b ? page('Customer', b) : page('Not found', '<div class="card">Customer not found.</div>', 404); }
  if (path === '/admin/messages') return page('Messages', await messages());
  if (path === '/admin/newsletter') return page('Newsletter', await newsletter());
  if (path === '/admin/newsletter/export.csv') { const ss = await stock.listSubscribers(); return csv(res, [['E-mail', 'Confirmed'], ...ss.map((s) => [s.email, dt(s.at)])], 'newsletter.csv'); }
  if (path === '/admin/analytics' || path === '/admin/visitors') return page('Analytics', await analytics(url));
  if (path === '/admin/google') return page('Google', await google(url));
  if (path === '/admin/stripe') return page('Stripe', await stripePage(url));
  if (path === '/admin/settings') return page('Settings', await settings(url));
  return page('Not found', '<div class="card">Page not found.</div>', 404);
}

module.exports = { handle, cron, notifyBackInStock };
