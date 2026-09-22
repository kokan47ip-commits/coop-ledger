import{E as T}from"./jspdf.es.min-CF0WMW0F.js";import{f}from"./format-BnGltutx.js";const N=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"],M=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];function S(e){if(e<20)return N[e];const r=Math.floor(e/10),t=e%10;return M[r]+(t?` ${N[t]}`:"")}function E(e){const r=Math.floor(e/100),t=e%100,l=[];return r&&l.push(`${N[r]} Hundred`),t&&l.push(S(t)),l.join(" ")}function B(e){const r=Math.floor(Math.abs(e)),t=Math.round((Math.abs(e)-r)*100);if(r===0&&t===0)return"Zero";const l=Math.floor(r/1e7),n=Math.floor(r%1e7/1e5),o=Math.floor(r%1e5/1e3),a=r%1e3,i=[];l&&i.push(`${E(l)} Crore`),n&&i.push(`${S(n)} Lakh`),o&&i.push(`${S(o)} Thousand`),a&&i.push(E(a));let s=i.join(" ");return t>0&&(s+=`${s?" and":""} Paise ${S(t)}`),s}function w(e){return`Rupees : ${B(e)} Only`}const P=["PLEASE PAY BY CROSSED A/C. PAYEE CHEQUE ONLY.","THIS BILL IS PAYABLE ON OR BEFORE LAST DAY OF THE MONTH","LATEFEES @18% WILL BE CHARGED ON OVERDUE MONTH"];function p(e){return new Intl.NumberFormat("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}).format(e)}function V(e){const r=["January","February","March","April","May","June","July","August","September","October","November","December"],[t,l]=e.split("-");return`${r[Number(l)-1]??l},${t}`}function j(e){return[e.name,e.registrationNo??"",e.address??""].filter(Boolean)}function D(e,r,t){const l=e.internal.pageSize.getWidth(),n=j(r);e.setFont("helvetica","bold"),e.setFontSize(13),e.text(n[0],l/2,t,{align:"center"}),e.setFont("helvetica","normal"),e.setFontSize(9);let o=t+14;for(const a of n.slice(1))e.text(a,l/2,o,{align:"center"}),o+=12;return o}function Y(e,r){const t=new T({unit:"pt",format:"a4"}),l=t.internal.pageSize.getWidth(),n=t.internal.pageSize.getHeight(),o=40,a=l-o*2,i=44;let s=D(t,e.society,i+20);s+=6,t.setFont("helvetica","bold"),t.setFontSize(10),t.text(`Bill for the Month of ${e.periodLabel}`,l/2,s,{align:"center"}),s+=14,t.setDrawColor(60),t.setLineWidth(.8),t.line(o,s,o+a,s),s+=16;const x=o+a*.62,d=y=>y;t.setFontSize(10),t.setFont("helvetica","normal"),t.text("Bill No:",o+6,s),t.setFont("helvetica","bold"),t.text(d(String(e.billNo)),o+70,s),t.setFont("helvetica","normal"),t.text("Bill Date:",x,s),t.text(f(e.billDate),x+60,s),s+=16,t.text("Name:",o+6,s),t.setFont("helvetica","bold"),t.text(e.memberName.toUpperCase(),o+70,s),e.memberName2&&(s+=14,t.setFont("helvetica","normal"),t.text(e.memberName2.toUpperCase(),o+70,s)),t.setFont("helvetica","normal"),t.text("Area :",x,s-(e.memberName2?14:0)),e.area&&t.text(e.area,x+60,s-(e.memberName2?14:0)),s+=16,t.text("Flat",o+6,s),t.text(e.flatNo??"",o+70,s),t.text("Due Date:",x,s),t.text(f(e.dueDate),x+60,s),s+=8;const v=s,g=o+a-120;t.line(o,s,o+a,s),s+=14,t.setFont("helvetica","bold"),t.setFontSize(10.5),t.text("P A R T I C U L A R S",o+8,s),t.text("A M O U N T",o+a-8,s,{align:"right"}),t.line(o,s+5,o+a,s+5),t.line(g,v,g,n-240),s+=20,t.setFont("helvetica","normal"),t.setFontSize(10),e.lines.forEach((y,H)=>{t.text(`${H+1}. ${y.name.toUpperCase()}`,o+14,s),t.text(p(y.amount),o+a-10,s,{align:"right"}),s+=15});const b=n-240,u=o+a*.42,$=o+a-10;t.line(o,b,o+a,b),t.line(u,b,u,b+96);let m=b+18;t.text(w(e.totalDue),o+8,m,{align:"left",maxWidth:u-o-20}),t.text("Total:",u+110,m,{align:"right"}),t.text(p(e.total),$,m,{align:"right"}),m+=18,t.text("Arrears",u+110,m,{align:"right"}),t.text(p(e.arrears),$,m,{align:"right"}),m+=22,t.setFont("helvetica","bold"),t.text("Total Due:",u+110,m,{align:"right"}),t.text(p(e.totalDue),$,m,{align:"right"}),t.setFont("helvetica","normal");const h=b+96;t.line(o,h,o+a,h);const F=o+a*.5;t.line(F,h,F,h+92),t.line(o,h+92,o+a,h+92),t.line(o,i,o,h+92),t.line(o+a,i,o+a,h+92),t.line(o,i,o+a,i),t.setFontSize(8);let R=h+16;for(const y of P)t.text(y,o+6,R),R+=12;t.setFont("helvetica","bold"),t.setFontSize(9),t.text(`For ${e.society.name}`,o+a-8,h+16,{align:"right"}),t.setFont("helvetica","normal"),t.setFontSize(8),t.text("SECRETARY",o+a-8,h+78,{align:"right"}),t.setDrawColor(120),t.setLineDashPattern([6,4],0),t.line(o,h+120,o+a,h+120),t.setLineDashPattern([],0),t.save(r)}function _(e,r){const t=new T({unit:"pt",format:"a4"}),l=t.internal.pageSize.getWidth();t.internal.pageSize.getHeight();const n=40,o=l-n*2,a=60;D(t,e.society,a+22);let i=a+78;t.setDrawColor(60),t.setLineWidth(.8),t.line(n,i,n+o,i),i+=26,t.setFont("helvetica","bold"),t.setFontSize(13),t.text("R E C E I P T",l/2,i,{align:"center"}),t.setLineWidth(.6);const s=t.getTextWidth("R E C E I P T");t.line(l/2-s/2,i+4,l/2+s/2,i+4),i+=30,t.setFont("helvetica","normal"),t.setFontSize(10.5),t.text("Receipt No.:",n+8,i),t.text(String(e.receiptNo),n+90,i),t.text("Receipt Date:",l-190,i),t.text(f(e.receiptDate),l-100,i,{align:"right"}),i+=22,t.line(n,i,n+o,i),i+=26;const x=[{pre:"Received with thanks from ",bold:e.memberName.toUpperCase()},{pre:"the sum of ",bold:`Rs. ${p(e.amount)}/-`,post:" in words ",underline:!0}];let d=i;for(const g of x){t.setFont("helvetica","normal"),g.pre&&t.text(g.pre,n+12,d);const b=g.pre?t.getTextWidth(g.pre):0;if(t.setFont("helvetica","bold"),t.text(g.bold??"",n+12+b,d),g.underline){const u=t.getTextWidth(g.bold??"");t.setLineWidth(.5),t.line(n+12+b,d+2.5,n+12+b+u,d+2.5),t.setFont("helvetica","normal"),t.setFontSize(9),t.text(w(e.amount),n+12+b+u+24,d),t.setFontSize(10.5)}d+=20}t.setFont("helvetica","normal"),t.text(`in Part/Full Payment of ${e.purpose}`,n+12,d),d+=20;const v=[e.reference,e.mode].filter(Boolean).join(" · ");t.text(`being the charges for the Flat ${e.flatNo??"—"}${v?`   Cheque No.~ ${v}`:""}`,n+12,d),d+=34,t.setLineWidth(.8),t.rect(n+12,d,170,30),t.setFont("helvetica","bold"),t.setFontSize(11),t.text(`Rs. ${p(e.amount)} /-`,n+22,d+19),t.setFont("helvetica","normal"),t.setFontSize(7.5),t.text("*Subject to realisation of cheque(s).",n+12,d+42),t.setFont("helvetica","bold"),t.setFontSize(9),t.text(`For ${e.society.name}`,n+o-8,d+6,{align:"right"}),t.setFont("helvetica","normal"),t.setFontSize(8),t.text("SECRETARY",n+o-8,d+62,{align:"right"}),t.setLineWidth(.8),t.rect(n,a,o,d+70-a),t.setDrawColor(120),t.setLineDashPattern([6,4],0),t.line(n,d+100,n+o,d+100),t.setLineDashPattern([],0),t.save(r)}const z=`
  body { font-family: Arial, Helvetica, sans-serif; color:#111; }
  .wrap { border:1.5px solid #111; padding:0; margin:0 auto; max-width:720px; }
  .hdr { text-align:center; padding:14px 10px 10px; }
  .hdr h1 { font-size:15pt; margin:0; font-weight:bold; }
  .hdr p { font-size:9pt; margin:3px 0; }
  .titlebar { text-align:center; font-weight:bold; font-size:11pt; border-top:1px solid #111; border-bottom:1px solid #111; padding:6px; }
  .meta { width:100%; font-size:10pt; padding:10px; border-collapse:collapse; }
  .meta td { padding:3px 6px; }
  .parthead { width:100%; border-collapse:collapse; }
  .parthead th { border-top:1px solid #111; border-bottom:1px solid #111; font-size:10.5pt; padding:6px 8px; text-align:left; letter-spacing:2px; }
  .parthead th.r { text-align:right; }
  .lines { width:100%; border-collapse:collapse; min-height:180px; }
  .lines td { font-size:10pt; padding:4px 8px; }
  .lines td.num { text-align:right; }
  .tot { width:100%; border-collapse:collapse; border-top:1px solid #111; }
  .tot td { font-size:10pt; padding:4px 8px; }
  .tot .lbl { text-align:right; }
  .tot .val { text-align:right; width:120px; }
  .tot .grand { font-weight:bold; border-top:1px solid #111; }
  .foot { width:100%; border-top:1px solid #111; font-size:8pt; border-collapse:collapse; }
  .foot td { padding:8px; vertical-align:top; }
  .foot .sig { text-align:right; font-weight:bold; font-size:9pt; }
  .receipt-body { padding:16px 14px; font-size:11pt; line-height:1.9; }
  .amtbox { border:1px solid #111; display:inline-block; padding:6px 14px; font-weight:bold; margin-top:14px; }
  .tear { border-bottom:2px dashed #888; margin:26px auto; max-width:720px; }
  table.sign { width:100%; }
`;function C(e){return`<div class="hdr">
    <h1>${c(e.name.toUpperCase())}</h1>
    ${e.registrationNo?`<p>${c(e.registrationNo)}</p>`:""}
    ${e.address?`<p>${c(e.address)}</p>`:""}
  </div>`}function c(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function W(e){return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Bill ${c(String(e.billNo))}</title><style>${z}</style></head>
<body><div class="wrap">
  ${C(e.society)}
  <div class="titlebar">Bill for the Month of ${c(e.periodLabel)}</div>
  <table class="meta">
    <tr><td>Bill No:</td><td><b>${c(String(e.billNo))}</b></td><td style="text-align:right">Bill Date:</td><td>${f(e.billDate)}</td></tr>
    <tr><td>Name:</td><td><b>${c(e.memberName.toUpperCase())}</b>${e.memberName2?`<br>${c(e.memberName2.toUpperCase())}`:""}</td><td style="text-align:right">Area :</td><td>${c(e.area??"")}</td></tr>
    <tr><td>Flat</td><td>${c(e.flatNo??"")}</td><td style="text-align:right">Due Date:</td><td>${f(e.dueDate)}</td></tr>
  </table>
  <table class="parthead"><tr><th>PARTICULARS</th><th class="r">AMOUNT</th></tr></table>
  <table class="lines">
    ${e.lines.map((r,t)=>`<tr><td>${t+1}.&nbsp; ${c(r.name.toUpperCase())}</td><td class="num">${p(r.amount)}</td></tr>`).join("")}
    ${Array.from({length:Math.max(0,6-e.lines.length)},()=>"<tr><td>&nbsp;</td><td></td></tr>").join("")}
  </table>
  <table class="tot">
    <tr><td rowspan="2" style="width:55%">${c(w(e.totalDue))}</td><td class="lbl">Total:</td><td class="val">${p(e.total)}</td></tr>
    <tr><td class="lbl">Arrears</td><td class="val">${p(e.arrears)}</td></tr>
    <tr><td></td><td class="lbl grand">Total Due:</td><td class="val grand">${p(e.totalDue)}</td></tr>
  </table>
  <table class="foot">
    <tr><td style="width:50%">${P.map(c).join("<br>")}</td>
    <td class="sig">For ${c(e.society.name)}<br><br><br><span style="font-weight:normal">SECRETARY</span></td></tr>
  </table>
</div><div class="tear"></div></body></html>`}function J(e,r){L(W(e),r)}function A(e){return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipt ${c(String(e.receiptNo))}</title><style>${z}</style></head>
<body><div class="wrap">
  ${C(e.society)}
  <div class="titlebar" style="text-decoration:underline; letter-spacing:3px;">RECEIPT</div>
  <table class="meta">
    <tr><td>Receipt No.:</td><td>${c(String(e.receiptNo))}</td><td style="text-align:right">Receipt Date:</td><td>${f(e.receiptDate)}</td></tr>
  </table>
  <div class="receipt-body">
    Received with thanks from <b>${c(e.memberName.toUpperCase())}</b><br>
    the sum of <b>Rs. ${p(e.amount)}/-</b> in words <b><u>${c(w(e.amount))}</u></b><br>
    in Part/Full Payment of ${c(e.purpose)}<br>
    being the charges for the Flat ${c(e.flatNo??"—")}${e.reference?` &nbsp;<b>Cheque No.~ ${c(e.reference)}</b>`:""}
    <table class="sign"><tr>
      <td><span class="amtbox">Rs. ${p(e.amount)} /-</span><br><span style="font-size:7.5pt">*Subject to realisation of cheque(s).</span></td>
      <td style="text-align:right; vertical-align:top"><b>For ${c(e.society.name)}</b><br><br><br><span style="font-weight:normal">SECRETARY</span></td>
    </tr></table>
  </div>
</div><div class="tear"></div></body></html>`}function X(e,r){L(A(e),r)}function L(e,r){const t=new Blob(["\uFEFF",e],{type:"application/msword"}),l=URL.createObjectURL(t),n=document.createElement("a");n.href=l,n.download=r,n.click(),URL.revokeObjectURL(l)}function G(e){const r=window.open("","_blank","width=860,height=900");r&&(r.document.write(W(e).replace(/^<html[^>]*>/,"<html>").replace(/<meta[^>]*>/,"")),r.document.close(),r.focus(),setTimeout(()=>r.print(),300))}function Q(e){const r=window.open("","_blank","width=860,height=700");r&&(r.document.write(A(e).replace(/^<html[^>]*>/,"<html>").replace(/<meta[^>]*>/,"")),r.document.close(),r.focus(),setTimeout(()=>r.print(),300))}const k={member_receipt:"Receipt Voucher",other_receipt:"Receipt Voucher",payment:"Payment Voucher",journal:"Journal Voucher"};function Z(e){return k[e]??"Voucher"}function O(e){const r=["Code","Ledger / Particulars","Debit","Credit"],t=e.lines.map(o=>[o.code??"",[o.name.toUpperCase(),o.note?`    ${o.note}`:""].filter(Boolean).join(`
`),p(o.debit),p(o.credit)]),l=e.lines.reduce((o,a)=>o+a.debit,0),n=e.lines.reduce((o,a)=>o+a.credit,0);return t.push(["","TOTAL",p(l),p(n)]),{head:r,rows:t,totDr:l,totCr:n}}function K(e,r){const t=new T({unit:"pt",format:"a4"}),l=t.internal.pageSize.getWidth(),n=40,o=l-n*2,a=44;D(t,e.society,a+20);let i=a+78;t.setDrawColor(60),t.setLineWidth(.8),t.line(n,i,n+o,i),i+=24,t.setFont("helvetica","bold"),t.setFontSize(13);const s=e.title.toUpperCase().split("").join(" ");t.text(s,l/2,i,{align:"center"}),t.setLineWidth(.6);const x=t.getTextWidth(s);t.line(l/2-x/2,i+4,l/2+x/2,i+4),i+=28,t.setFont("helvetica","normal"),t.setFontSize(10.5),t.text("Voucher No.:",n+8,i),t.setFont("helvetica","bold"),t.text(e.voucherNo,n+90,i),t.setFont("helvetica","normal"),t.text("Voucher Date:",l-210,i),t.text(f(e.voucherDate),l-100,i,{align:"right"}),i+=18,e.party&&(t.text(`${e.title.startsWith("Payment")?"Paid to":e.title.startsWith("Receipt")?"Received from":"Party"}:`,n+8,i),t.setFont("helvetica","bold"),t.text(e.party.toUpperCase(),n+90,i),t.setFont("helvetica","normal"),i+=18),e.chequeNo&&(t.text(`Cheque No.~ ${e.chequeNo}${e.chequeDate?`  dt ${f(e.chequeDate)}`:""}${e.bankName?`  ·  ${e.bankName}`:""}`,n+8,i),i+=18),i+=6,t.line(n,i,n+o,i),i+=16;const{head:d,rows:v}=O(e),g=n+8,b=n+70,u=n+o-190,$=n+o-10;t.setFont("helvetica","bold"),t.setFontSize(10.5),t.text(d[0],g,i),t.text(d[1],b,i),t.text(d[2],u,i,{align:"right"}),t.text(d[3],$,i,{align:"right"}),t.line(n,i+5,n+o,i+5),i+=22,t.setFont("helvetica","normal"),t.setFontSize(10);for(const h of v){t.text(String(h[0]),g,i),t.setFont("helvetica",h[1]==="TOTAL"?"bold":"normal");const F=String(h[1]).split(`
`);t.text(F[0],b,i),F[1]&&(t.setFont("helvetica","normal"),t.setFontSize(8.5),t.text(F[1].trim(),b+10,i+11),t.setFontSize(10)),t.setFont("helvetica",h[1]==="TOTAL"?"bold":"normal"),t.text(h[2],u,i,{align:"right"}),t.text(h[3],$,i,{align:"right"}),t.setFont("helvetica","normal"),i+=h[1].includes(`
`)?26:16}t.line(n,i-10,n+o,i-10),i+=16,t.setFont("helvetica","italic"),t.setFontSize(9.5),t.text(`Rupees: ${w(e.amount)} Only`,n+8,i,{maxWidth:o-16}),i+=26,e.narration&&(t.setFont("helvetica","normal"),t.setFontSize(9),t.text(`Narration: ${e.narration}`,n+8,i,{maxWidth:o-120}),i+=16);const m=Math.max(i+40,t.internal.pageSize.getHeight()-150);t.setFont("helvetica","bold"),t.setFontSize(9),t.text(`For ${e.society.name}`,n+o-8,m,{align:"right"}),t.setDrawColor(60),t.setLineWidth(.6),t.setLineDashPattern([2,2],0),t.line(n+10,m+40,n+o*.3,m+40),t.line(n+o*.45,m+40,n+o-10,m+40),t.setLineDashPattern([],0),t.setFont("helvetica","normal"),t.setFontSize(8),t.text("Receiver's signature",n+10,m+54),t.text("Authorised signatory",n+o*.45,m+54),t.setLineWidth(.8),t.rect(n,a,o,m+66-a),t.save(r)}function U(e){O(e);const r=e.title.startsWith("Payment")?"Paid to":e.title.startsWith("Receipt")?"Received from":"Party";return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${c(e.title)} ${c(e.voucherNo)}</title><style>${z}
  .vhead { width:100%; font-size:10pt; border-collapse:collapse; padding:0 10px; }
  .vhead td { padding:3px 6px; }
  .vtable { width:100%; border-collapse:collapse; margin-top:8px; }
  .vtable th { border-top:1px solid #111; border-bottom:1px solid #111; font-size:10pt; padding:5px 8px; text-align:left; }
  .vtable th.r { text-align:right; }
  .vtable td { font-size:10pt; padding:4px 8px; border-bottom:1px solid #ddd; }
  .vtable td.num { text-align:right; }
  .vtable tr.total td { font-weight:bold; border-bottom:1px solid #111; border-top:1px solid #111; }
  .words { font-size:10pt; font-style:italic; padding:10px; }
  .vsig { width:100%; padding:10px; border-collapse:collapse; }
  .vsig td { font-size:9pt; padding-top:36px; }
  .sigline { border-top:1px dotted #555; margin:0 30px; }
</style></head>
<body><div class="wrap">
  ${C(e.society)}
  <div class="titlebar" style="text-decoration:underline; letter-spacing:3px;">${c(e.title.toUpperCase())}</div>
  <table class="vhead">
    <tr><td>Voucher No.: <b>${c(e.voucherNo)}</b></td><td style="text-align:right">Voucher Date: ${f(e.voucherDate)}</td></tr>
    ${e.party?`<tr><td colspan="2">${c(r)}: <b>${c(e.party.toUpperCase())}</b></td></tr>`:""}
    ${e.chequeNo?`<tr><td colspan="2">Cheque No.~ <b>${c(e.chequeNo)}</b>${e.chequeDate?` dt ${f(e.chequeDate)}`:""}${e.bankName?` · ${c(e.bankName)}`:""}</td></tr>`:""}
  </table>
  <table class="vtable">
    <thead><tr><th>Code</th><th>Ledger / Particulars</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead>
    <tbody>
      ${e.lines.map(t=>`<tr><td>${c(t.code??"")}</td><td>${c(t.name.toUpperCase())}${t.note?`<br><span style="font-size:8.5pt">&nbsp;&nbsp;&nbsp;${c(t.note)}</span>`:""}</td><td class="num">${p(t.debit)}</td><td class="num">${p(t.credit)}</td></tr>`).join("")}
      <tr class="total"><td></td><td>TOTAL</td><td class="num">${p(e.lines.reduce((t,l)=>t+l.debit,0))}</td><td class="num">${p(e.lines.reduce((t,l)=>t+l.credit,0))}</td></tr>
    </tbody>
  </table>
  <div class="words">Rupees: ${c(w(e.amount))} Only</div>
  ${e.narration?`<div class="words" style="font-style:normal">Narration: ${c(e.narration)}</div>`:""}
  <table class="vsig">
    <tr>
      <td style="width:50%"><div class="sigline"></div><div style="margin-top:4px">Receiver's signature</div></td>
      <td style="width:50%; text-align:right"><b>For ${c(e.society.name)}</b><div class="sigline"></div><div style="margin-top:4px">Authorised signatory</div></td>
    </tr>
  </table>
</div><div class="tear"></div></body></html>`}function tt(e,r){L(U(e),r)}function et(e){const r=window.open("","_blank","width=860,height=800");r&&(r.document.write(U(e).replace(/^<html[^>]*>/,"<html>").replace(/<meta[^>]*>/,"")),r.document.close(),r.focus(),setTimeout(()=>r.print(),300))}export{J as a,Y as b,B as c,G as d,_ as e,X as f,K as g,tt as h,et as i,V as p,Q as r,Z as v};
