// Edit 3D Pixaroma - the editor's own stylesheet. Every rule is scoped under .pix-e3d-editor (a class the editor adds
// to its overlay), so nothing here can reach another editor or ComfyUI (3d-builder.md, CSS isolation).
//
// This CSS lives in a JS template literal: a backtick anywhere inside it, even in a comment, ends the literal and
// breaks the module (CLAUDE.md #35). Use "double quotes" in comments here.

const E = ".pix-e3d-editor";
const A = "#f66744";
let _done = false;

export function injectEditorCSS() {
  if (_done) return;
  _done = true;
  const css = `
${E} .pxf-sidebar-right{overflow:hidden;}
${E} .pix-e3d-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;}
${E} .pix-e3d-scroll::-webkit-scrollbar{width:5px;}
${E} .pix-e3d-scroll::-webkit-scrollbar-thumb{background:#3a3d40;border-radius:3px;}
${E} .pxf-btn:not(.pxf-btn-accent):not(.pxf-btn-danger):hover{background:${A};border-color:${A};color:#fff;}
${E} .pxf-workspace{background:#141517;}
${E} .pix-e3d-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none;}
${E} .pix-e3d-lasso{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;}
${E} .pix-e3d-axes{position:absolute;right:10px;bottom:10px;width:92px;height:92px;z-index:5;pointer-events:none;}
${E} .pix-e3d-ring{position:absolute;display:none;border:1.5px solid ${A};border-radius:50%;pointer-events:none;z-index:4;box-shadow:0 0 0 1px rgba(0,0,0,.45),inset 0 0 0 1px rgba(0,0,0,.25);}
${E} .pix-e3d-ring.remove{border-color:#9fb3c8;border-style:dashed;}
${E} .pix-e3d-ring.move{border-color:#7ee07e;}
${E} .pxf-tool-info{font-size:10.5px;line-height:1.4;max-width:70%;}
${E} .pxf-tool-info.busy{color:${A};}
${E} .pxf-tool-info.help{font-family:"Segoe UI",system-ui,sans-serif;font-size:12px;color:#e4e4e4;border:1px solid rgba(246,103,68,.6);}
${E} .pxf-tool-info.help b{color:${A};margin-right:6px;}
${E} .pix-e3d-toast{position:absolute;top:12px;left:50%;transform:translateX(-50%);background:rgba(20,21,22,.96);border:1px solid ${A};color:#ddd;padding:8px 14px;border-radius:6px;font-size:12px;max-width:76%;line-height:1.45;opacity:0;transition:opacity .2s;pointer-events:none;z-index:6;text-align:center;}
${E} .pix-e3d-toast.show{opacity:1;}
${E}.pix-e3d-jobbing .pix-e3d-toast{top:62px;}
${E} .pix-e3d-job{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:8;display:none;align-items:center;gap:12px;background:rgba(20,21,22,.97);border:1px solid ${A};border-radius:6px;padding:7px 8px 7px 14px;color:#ddd;font-size:12px;max-width:80%;box-shadow:0 6px 20px rgba(0,0,0,.5);}
${E} .pix-e3d-job.show{display:flex;}
${E} .pix-e3d-job .spin{width:14px;height:14px;box-sizing:border-box;border:2px solid rgba(246,103,68,.3);border-top-color:${A};border-radius:50%;animation:pix-e3d-spin .8s linear infinite;flex:0 0 auto;}
${E} .pix-e3d-job .msg{line-height:1.4;}
@keyframes pix-e3d-spin{to{transform:rotate(360deg);}}
${E} .pix-e3d-legend{position:absolute;right:110px;bottom:10px;z-index:5;font-size:10.5px;color:#bbb;background:rgba(0,0,0,.7);padding:5px 10px;border-radius:5px;display:none;pointer-events:none;}
${E} .pix-e3d-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 4px 0 8px;}
${E} .pix-e3d-off{display:none !important;}
${E} .pix-e3d-modes{display:flex;gap:3px;margin:8px 10px 0;background:rgba(0,0,0,.25);border:1px solid #3a3d40;border-radius:6px;padding:3px;}
${E} .pix-e3d-modes button{flex:1;background:transparent;border:1px solid transparent;color:#aaa;font:11.5px "Segoe UI",system-ui,sans-serif;padding:6px 4px;border-radius:4px;cursor:pointer;transition:all .12s;white-space:nowrap;}
${E} .pix-e3d-modes button:hover{color:${A};border-color:${A};}
${E} .pix-e3d-modes button.on{background:${A};color:#fff;border-color:${A};}
${E} .pix-e3d-check{display:flex;flex-direction:column;gap:3px;}
${E} .pix-e3d-check-row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:#bbb;background:#1c1e1f;border:1px solid #2a2c2f;border-left:2px solid #3a3d40;border-radius:4px;padding:4px 8px;}
${E} .pix-e3d-check-row b{font-weight:400;color:#ddd;font-family:Consolas,monospace;font-size:10.5px;text-align:right;}
${E} .pix-e3d-check-row.ok{border-left-color:#3ec371;}
${E} .pix-e3d-check-row.warn{border-left-color:#e0a33a;}
${E} .pix-e3d-check-row.warn b{color:#e0a33a;}
${E} .pix-e3d-check-row.dim{color:#777;}
${E} .pix-e3d-check-row b{flex:1 1 auto;}
${E} .pix-e3d-fix{flex:0 0 auto;background:transparent;border:1px solid #e0a33a;color:#e0a33a;font:10px "Segoe UI",system-ui,sans-serif;padding:1px 8px;border-radius:9px;cursor:pointer;transition:all .12s;}
${E} .pix-e3d-fix:hover{background:${A};border-color:${A};color:#fff;}
${E} .pix-e3d-check-row:hover{border-color:${A};}
/* Two classes on the one element, so these beat the .pix-e3d-row rules further down whatever the order. */
${E} .pix-e3d-row.pix-e3d-symrow{margin-bottom:8px;}
${E} .pix-e3d-row.pix-e3d-symrow > span:first-child{width:62px;}
${E} .pix-e3d-tools{display:grid;grid-template-columns:1fr 1fr;gap:5px;}
${E} .pix-e3d-tool{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;height:50px;padding:0;background:#1c1e1f;border:1px solid #3a3d40;color:#ccc;border-radius:4px;cursor:pointer;font:11px "Segoe UI",system-ui,sans-serif;transition:all .12s;}
${E} .pix-e3d-tool svg{width:18px;height:18px;pointer-events:none;}
${E} .pix-e3d-tool:hover{border-color:${A};color:${A};}
${E} .pix-e3d-tool.active{background:${A};border-color:${A};color:#fff;}
${E} .pix-e3d-tool.active svg .red{stroke:#fff;}
${E} .pix-e3d-g2,${E} .pix-e3d-g3,${E} .pix-e3d-g4{display:grid;gap:4px;margin-top:4px;}
${E} .pix-e3d-g2{grid-template-columns:repeat(2,1fr);}
${E} .pix-e3d-g3{grid-template-columns:repeat(3,1fr);}
${E} .pix-e3d-g4{grid-template-columns:repeat(4,1fr);}
${E} .pix-e3d-g2 .pxf-btn,${E} .pix-e3d-g3 .pxf-btn,${E} .pix-e3d-g4 .pxf-btn{padding:4px 0;font-size:11px;}
${E} .pix-e3d-count{font-size:11px;color:#bbb;margin-bottom:3px;}
${E} .pix-e3d-brushname{font-size:12px;color:${A};margin-bottom:8px;}
${E} .pix-e3d-locknote{font-size:10.5px;color:#8d9296;line-height:1.45;margin:-2px 0 8px;}
${E} .pix-e3d-ring.sculpt{border-color:#7ee07e;}
/* The mirrored ring is deliberately a different COLOUR, not a fainter copy of the real one: it was reported as hard
   to tell apart. Declared LAST so it wins over every other ring look, and written with a CSS comment because a
   double slash inside this literal is not a comment at all, it is a selector that eats the rule after it. */
${E} .pix-e3d-ring.mask{border-color:${A};border-width:2px;}
${E} .pix-e3d-ring.mirror{border-color:#6aa0ff;border-style:dashed;border-width:2px;opacity:.95;}
${E} .pix-e3d-hint{font-size:11px;color:#8d9296;line-height:1.45;margin-top:7px;}
${E} .pix-e3d-seg{display:flex;background:rgba(0,0,0,.25);border:1px solid #3a3d40;border-radius:5px;padding:2px;gap:2px;}
${E} .pix-e3d-seg button{flex:1;background:transparent;border:1px solid transparent;color:#aaa;font:11px "Segoe UI",system-ui,sans-serif;padding:4px 6px;border-radius:4px;cursor:pointer;transition:all .12s;white-space:nowrap;}
${E} .pix-e3d-seg button:hover{color:${A};border-color:${A};}
${E} .pix-e3d-seg button.on{background:${A};color:#fff;border-color:${A};}
${E} .pxf-titlebar-center .pix-e3d-seg button{padding:4px 16px;font-size:12px;}
${E} .pix-e3d-sw-row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;color:#c4c4c4;margin-top:8px;cursor:pointer;user-select:none;}
${E} .pix-e3d-sw-row:hover > span:first-child{color:${A};}
${E} .pix-e3d-sw{width:30px;height:16px;border-radius:8px;background:#3a3d40;position:relative;flex-shrink:0;transition:background .15s;}
${E} .pix-e3d-sw::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#bbb;transition:left .15s;}
${E} .pix-e3d-sw.on{background:${A};}
${E} .pix-e3d-sw.on::after{left:16px;background:#fff;}
${E} .pix-e3d-slider{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:11px;color:#8d9296;}
${E} .pix-e3d-slider input{flex:1;min-width:0;accent-color:${A};}
${E} .pix-e3d-slider b{width:38px;text-align:right;color:#ccc;font-weight:400;font-family:Consolas,monospace;font-size:10.5px;}
${E} .pix-e3d-wide{width:100%;justify-content:space-between;margin-bottom:6px;}
${E} .pix-e3d-under{margin:-1px 0 10px;}
/* A settings row BELONGS to the button above it, and must not read as more buttons. The button already has no
   bottom gap (.pix-e3d-wide margin-bottom 6px is cancelled here), the row is indented under it and carries a name
   on the left, and a left rule runs down the pair so the eye groups them. Reported as "buttons that look like it
   doesnt do nothing": five chips styled like actions, joined to their owner by nothing but a -1px margin. */
${E} .pix-e3d-wide.pix-e3d-owner{margin-bottom:0;border-bottom-left-radius:0;border-bottom-right-radius:0;}
${E} .pix-e3d-setrow{margin:0 0 10px;padding:5px 6px 5px 8px;background:rgba(0,0,0,.14);border:1px solid #2a2c2f;border-top:none;border-radius:0 0 5px 5px;gap:8px;}
${E} .pix-e3d-setrow > span:first-child{width:auto;min-width:42px;flex:0 0 auto;color:#8d9296;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;}
${E} .pix-e3d-setrow .pix-e3d-seg{flex:1;background:transparent;border:none;padding:0;}
${E} .pix-e3d-setrow .pix-e3d-seg button{padding:3px 4px;}
${E} .pix-e3d-btnval{font-size:10px;color:${A};background:rgba(0,0,0,.28);border:1px solid #3a3d40;border-radius:10px;padding:0 8px;line-height:16px;font-family:Consolas,monospace;}
${E} .pxf-btn:hover .pix-e3d-btnval{color:#fff;border-color:rgba(255,255,255,.5);}
/* margin-left:auto keeps a badge and a value TOGETHER at the right edge. The button is a flex row set to
   space-between, so with three children (name, badge, value) the badge would otherwise be stranded in the middle
   of the button. An auto margin eats the free space before space-between runs. Fill holes is the only button
   carrying both; on a badge-only button this lands it exactly where space-between already put it. */
${E} .pix-e3d-badge{margin-left:auto;font-size:10px;color:#9aa3aa;background:#1c1e1f;border:1px solid #3a3d40;border-radius:10px;padding:0 7px;line-height:16px;}
${E} .pxf-btn:hover .pix-e3d-badge{color:#fff;border-color:rgba(255,255,255,.5);background:rgba(0,0,0,.25);}
${E} .pxf-top-options{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;min-height:36px;padding:4px 10px;box-sizing:border-box;}
${E} .pxf-top-options input[type=range]{width:130px;accent-color:${A};}
${E} .pix-e3d-opt-label{color:#bbb;}
${E} .pix-e3d-opt-val{color:#ddd;font-family:Consolas,monospace;font-size:11px;min-width:52px;}
${E} .pix-e3d-opt-hint{color:#8d9296;}
${E} .pix-e3d-opt-sep{width:1px;height:18px;background:#3a3d40;}
${E} .pxf-top-options .pix-e3d-seg button{padding:3px 10px;}
${E} .pix-e3d-chip{font-size:11px;padding:2px 9px;border-radius:10px;border:1px solid #3a3d40;color:#aaa;}
${E} .pix-e3d-chip.a.on{background:#2f6fd6;border-color:#2f6fd6;color:#fff;}
${E} .pix-e3d-chip.b.on{background:#3d9a59;border-color:#3d9a59;color:#fff;}
${E} .pix-e3d-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px;color:#bbb;}
${E} .pix-e3d-row > span:first-child{width:50px;flex:0 0 auto;}
${E} .pix-e3d-row .pix-e3d-seg{flex:1;}
${E} .pix-e3d-row .pix-e3d-seg button{padding:4px 2px;}
${E} .pix-e3d-name{flex:1;min-width:0;height:26px;box-sizing:border-box;background:#111;color:#ddd;border:1px solid #3a3d40;border-radius:4px;padding:0 8px;font:11px Consolas,monospace;}
${E} .pix-e3d-name:focus{outline:none;border-color:${A};}
${E} .pix-e3d-history{margin:0;padding-left:20px;font-size:11px;color:#c4c4c4;line-height:1.6;}
${E} .pix-e3d-history li.dim{list-style:none;margin-left:-20px;color:#777;}
${E} .pix-e3d-history li.undone{color:#666;text-decoration:line-through;}
${E} .pxf-help-content{column-count:1;}
${E} .pxf-help-content h4{color:${A};margin:14px 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;}
${E} .pxf-help-content h4:first-child{margin-top:0;}
${E} .pxf-help-content p{margin:0 0 6px;}
${E} .pxf-help-content ul{margin:0 0 8px;padding-left:18px;}
${E} .pxf-help-content table{border-collapse:collapse;width:100%;margin:2px 0 8px;}
${E} .pxf-help-content td{padding:3px 10px 3px 0;vertical-align:top;border-bottom:1px solid #2a2c2f;}
${E} .pxf-help-content td:first-child{color:#fff;white-space:nowrap;}
${E} .pxf-help-content td.ex{color:#9aa0a6;font-style:italic;}
`;
  const s = document.createElement("style");
  s.id = "pix-e3d-editor-css";
  s.textContent = css;
  document.head.appendChild(s);
}
