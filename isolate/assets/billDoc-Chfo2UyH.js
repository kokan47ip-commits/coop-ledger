import{E as N}from"./jspdf.es.min-oD0URWGU.js";import{f as x}from"./format-V6CGZsZt.js";const T=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"],M=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];function S(t){if(t<20)return T[t];const i=Math.floor(t/10),e=t%10;return M[i]+(e?` ${T[e]}`:"")}function E(t){const i=Math.floor(t/100),e=t%100,s=[];return i&&s.push(`${T[i]} Hundred`),e&&s.push(S(e)),s.join(" ")}function j(t){const i=Math.floor(Math.abs(t)),e=Math.round((Math.abs(t)-i)*100);if(i===0&&e===0)return"Zero";const s=Math.floor(i/1e7),n=Math.floor(i%1e7/1e5),o=Math.floor(i%1e5/1e3),l=i%1e3,r=[];s&&r.push(`${E(s)} Crore`),n&&r.push(`${S(n)} Lakh`),o&&r.push(`${S(o)} Thousand`),l&&r.push(E(l));let a=r.join(" ");return e>0&&(a+=`${a?" and":""} Paise ${S(e)}`),a}function w(t){return`Rupees : ${j(t)} Only`}const P=["PLEASE PAY BY CROSSED A/C. PAYEE CHEQUE ONLY.","THIS BILL IS PAYABLE ON OR BEFORE LAST DAY OF THE MONTH","LATEFEES @18% WILL BE CHARGED ON OVERDUE MONTH"];function h(t){return new Intl.NumberFormat("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}).format(t)}function X(t){const i=["January","February","March","April","May","June","July","August","September","October","November","December"],[e,s]=t.split("-");return`${i[Number(s)-1]??s},${e}`}function I(t){return[t.name,t.registrationNo??"",t.address??""].filter(Boolean)}function D(t,i,e){const s=t.internal.pageSize.getWidth(),n=I(i);t.setFont("helvetica","bold"),t.setFontSize(13),t.text(n[0],s/2,e,{align:"center"}),t.setFont("helvetica","normal"),t.setFontSize(9);let o=e+14;for(const l of n.slice(1))t.text(l,s/2,o,{align:"center"}),o+=12;return o}function G(t,i){const e=new N({unit:"pt",format:"a4"}),s=e.internal.pageSize.getWidth(),n=e.internal.pageSize.getHeight(),o=40,l=s-o*2,r=44;let a=D(e,t.society,r+20);a+=6,e.setFont("helvetica","bold"),e.setFontSize(10),e.text(`Bill for the Month of ${t.periodLabel}`,s/2,a,{align:"center"}),a+=14,e.setDrawColor(60),e.setLineWidth(.8),e.line(o,a,o+l,a),a+=16;const p=o+l*.62,f=F=>F;e.setFontSize(10),e.setFont("helvetica","normal"),e.text("Bill No:",o+6,a),e.setFont("helvetica","bold"),e.text(f(String(t.billNo)),o+70,a),e.setFont("helvetica","normal"),e.text("Bill Date:",p,a),e.text(x(t.billDate),p+60,a),a+=16,e.text("Name:",o+6,a),e.setFont("helvetica","bold"),e.text(t.memberName.toUpperCase(),o+70,a),t.memberName2&&(a+=14,e.setFont("helvetica","normal"),e.text(t.memberName2.toUpperCase(),o+70,a)),e.setFont("helvetica","normal"),e.text("Area :",p,a-(t.memberName2?14:0)),t.area&&e.text(t.area,p+60,a-(t.memberName2?14:0)),a+=16,e.text("Flat",o+6,a),e.text(t.flatNo??"",o+70,a),e.text("Due Date:",p,a),e.text(x(t.dueDate),p+60,a),a+=8;const b=a,g=o+l-120;e.line(o,a,o+l,a),a+=14,e.setFont("helvetica","bold"),e.setFontSize(10.5),e.text("P A R T I C U L A R S",o+8,a),e.text("A M O U N T",o+l-8,a,{align:"right"}),e.line(o,a+5,o+l,a+5),e.line(g,b,g,n-240),a+=20,e.setFont("helvetica","normal"),e.setFontSize(10),t.lines.forEach((F,H)=>{e.text(`${H+1}. ${F.name.toUpperCase()}`,o+14,a),e.text(h(F.amount),o+l-10,a,{align:"right"}),a+=15});const u=n-240,v=o+l*.42,y=o+l-10;e.line(o,u,o+l,u),e.line(v,u,v,u+96);let m=u+18;e.text(w(t.totalDue),o+8,m,{align:"left",maxWidth:v-o-20}),e.text("Total:",v+110,m,{align:"right"}),e.text(h(t.total),y,m,{align:"right"}),m+=18,e.text("Arrears",v+110,m,{align:"right"}),e.text(h(t.arrears),y,m,{align:"right"}),m+=22,e.setFont("helvetica","bold"),e.text("Total Due:",v+110,m,{align:"right"}),e.text(h(t.totalDue),y,m,{align:"right"}),e.setFont("helvetica","normal");const d=u+96;e.line(o,d,o+l,d);const $=o+l*.5;e.line($,d,$,d+92),e.line(o,d+92,o+l,d+92),e.line(o,r,o,d+92),e.line(o+l,r,o+l,d+92),e.line(o,r,o+l,r),e.setFontSize(8);let R=d+16;for(const F of P)e.text(F,o+6,R),R+=12;e.setFont("helvetica","bold"),e.setFontSize(9),e.text(`For ${t.society.name}`,o+l-8,d+16,{align:"right"}),e.setFont("helvetica","normal"),e.setFontSize(8),e.text("SECRETARY",o+l-8,d+78,{align:"right"}),e.setDrawColor(120),e.setLineDashPattern([6,4],0),e.line(o,d+120,o+l,d+120),e.setLineDashPattern([],0),e.save(i)}function W(t,i,e,s,n){const o=s;D(t,i.society,o+22),i.copyLabel&&(t.setFont("helvetica","normal"),t.setFontSize(8),t.setTextColor(90),t.text(i.copyLabel.toUpperCase(),e+n-8,o+12,{align:"right"}),t.setTextColor(30));let l=o+78;t.setDrawColor(60),t.setLineWidth(.8),t.line(e,l,e+n,l),l+=26,t.setFont("helvetica","bold"),t.setFontSize(13),t.text("R E C E I P T",e+n/2,l,{align:"center"}),t.setLineWidth(.6);const r=t.getTextWidth("R E C E I P T");t.line(e+n/2-r/2,l+4,e+n/2+r/2,l+4),l+=30,t.setFont("helvetica","normal"),t.setFontSize(10.5),t.text("Receipt No.:",e+8,l),t.text(String(i.receiptNo),e+90,l),t.text("Receipt Date:",e+n-150,l),t.text(x(i.receiptDate),e+n-60,l,{align:"right"}),l+=22,t.line(e,l,e+n,l),l+=26;const a=[{pre:"Received with thanks from ",bold:i.memberName.toUpperCase()},{pre:"the sum of ",bold:`Rs. ${h(i.amount)}/-`,post:" in words ",underline:!0}];let p=l;for(const b of a){t.setFont("helvetica","normal"),b.pre&&t.text(b.pre,e+12,p);const g=b.pre?t.getTextWidth(b.pre):0;if(t.setFont("helvetica","bold"),t.text(b.bold??"",e+12+g,p),b.underline){const u=t.getTextWidth(b.bold??"");t.setLineWidth(.5),t.line(e+12+g,p+2.5,e+12+g+u,p+2.5),t.setFont("helvetica","normal"),t.setFontSize(9),t.text(w(i.amount),e+12+g+u+24,p),t.setFontSize(10.5)}p+=20}t.setFont("helvetica","normal"),t.text(`in Part/Full Payment of ${i.purpose}`,e+12,p),p+=20;const f=[i.reference,i.mode].filter(Boolean).join(" · ");return t.text(`being the charges for the Flat ${i.flatNo??"—"}${f?`   Cheque No.~ ${f}`:""}`,e+12,p),p+=34,t.setLineWidth(.8),t.rect(e+12,p,170,30),t.setFont("helvetica","bold"),t.setFontSize(11),t.text(`Rs. ${h(i.amount)} /-`,e+22,p+19),t.setFont("helvetica","normal"),t.setFontSize(7.5),t.text("*Subject to realisation of cheque(s).",e+12,p+42),t.setFont("helvetica","bold"),t.setFontSize(9),t.text(`For ${i.society.name}`,e+n-8,p+6,{align:"right"}),t.setFont("helvetica","normal"),t.setFontSize(8),t.text("SECRETARY",e+n-8,p+62,{align:"right"}),t.setLineWidth(.8),t.rect(e,o,n,p+70-o),p+70}function Q(t,i){const e=new N({unit:"pt",format:"a4"}),s=e.internal.pageSize.getWidth(),n=40,o=s-n*2,l=W(e,t,n,60,o);e.setDrawColor(120),e.setLineDashPattern([6,4],0),e.line(n,l+30,n+o,l+30),e.setLineDashPattern([],0),e.save(i)}function Z(t,i,e=!1){const s=new N({unit:"pt",format:"a4"}),n=s.internal.pageSize.getWidth(),o=40,l=n-o*2,r=e?2:1,a=b=>e?b===0?50:421:60;let p=0,f=0;for(const b of t){if(p>=r&&(s.addPage(),p=0),e&&p===1){const g=Math.round((f+a(1))/2);s.setDrawColor(120),s.setLineDashPattern([6,4],0),s.line(o,g,o+l,g),s.setLineDashPattern([],0)}f=W(s,{...b.data,copyLabel:b.copyLabel??b.data.copyLabel},o,a(p),l),p++}s.save(i)}const z=`
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
`;function C(t){return`<div class="hdr">
    <h1>${c(t.name.toUpperCase())}</h1>
    ${t.registrationNo?`<p>${c(t.registrationNo)}</p>`:""}
    ${t.address?`<p>${c(t.address)}</p>`:""}
  </div>`}function c(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function A(t){return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Bill ${c(String(t.billNo))}</title><style>${z}</style></head>
<body><div class="wrap">
  ${C(t.society)}
  <div class="titlebar">Bill for the Month of ${c(t.periodLabel)}</div>
  <table class="meta">
    <tr><td>Bill No:</td><td><b>${c(String(t.billNo))}</b></td><td style="text-align:right">Bill Date:</td><td>${x(t.billDate)}</td></tr>
    <tr><td>Name:</td><td><b>${c(t.memberName.toUpperCase())}</b>${t.memberName2?`<br>${c(t.memberName2.toUpperCase())}`:""}</td><td style="text-align:right">Area :</td><td>${c(t.area??"")}</td></tr>
    <tr><td>Flat</td><td>${c(t.flatNo??"")}</td><td style="text-align:right">Due Date:</td><td>${x(t.dueDate)}</td></tr>
  </table>
  <table class="parthead"><tr><th>PARTICULARS</th><th class="r">AMOUNT</th></tr></table>
  <table class="lines">
    ${t.lines.map((i,e)=>`<tr><td>${e+1}.&nbsp; ${c(i.name.toUpperCase())}</td><td class="num">${h(i.amount)}</td></tr>`).join("")}
    ${Array.from({length:Math.max(0,6-t.lines.length)},()=>"<tr><td>&nbsp;</td><td></td></tr>").join("")}
  </table>
  <table class="tot">
    <tr><td rowspan="2" style="width:55%">${c(w(t.totalDue))}</td><td class="lbl">Total:</td><td class="val">${h(t.total)}</td></tr>
    <tr><td class="lbl">Arrears</td><td class="val">${h(t.arrears)}</td></tr>
    <tr><td></td><td class="lbl grand">Total Due:</td><td class="val grand">${h(t.totalDue)}</td></tr>
  </table>
  <table class="foot">
    <tr><td style="width:50%">${P.map(c).join("<br>")}</td>
    <td class="sig">For ${c(t.society.name)}<br><br><br><span style="font-weight:normal">SECRETARY</span></td></tr>
  </table>
</div><div class="tear"></div></body></html>`}function K(t,i){L(A(t),i)}function O(t){return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipt ${c(String(t.receiptNo))}</title><style>${z}</style></head>
<body><div class="wrap">
  ${C(t.society)}
  <div class="titlebar" style="text-decoration:underline; letter-spacing:3px;">RECEIPT</div>
  ${t.copyLabel?`<p class="copytag">${c(t.copyLabel.toUpperCase())}</p>`:""}
  <table class="meta">
    <tr><td>Receipt No.:</td><td>${c(String(t.receiptNo))}</td><td style="text-align:right">Receipt Date:</td><td>${x(t.receiptDate)}</td></tr>
  </table>
  <div class="receipt-body">
    Received with thanks from <b>${c(t.memberName.toUpperCase())}</b><br>
    the sum of <b>Rs. ${h(t.amount)}/-</b> in words <b><u>${c(w(t.amount))}</u></b><br>
    in Part/Full Payment of ${c(t.purpose)}<br>
    being the charges for the Flat ${c(t.flatNo??"—")}${t.reference?` &nbsp;<b>Cheque No.~ ${c(t.reference)}</b>`:""}
    <table class="sign"><tr>
      <td><span class="amtbox">Rs. ${h(t.amount)} /-</span><br><span style="font-size:7.5pt">*Subject to realisation of cheque(s).</span></td>
      <td style="text-align:right; vertical-align:top"><b>For ${c(t.society.name)}</b><br><br><br><span style="font-weight:normal">SECRETARY</span></td>
    </tr></table>
  </div>
</div><div class="tear"></div></body></html>`}function tt(t,i){L(O(t),i)}function q(t){const i=O(t),e=i.indexOf("<body>"),s=i.lastIndexOf("</body>");return e<0||s<0?i:i.slice(e+6,s)}function U(t){return q(t).replace(/<div class="tear"><\/div>\s*$/,"")}function et(t,i){const e=t.map(n=>U({...n.data,copyLabel:n.copyLabel??n.data.copyLabel})).join('<div class="tear"></div>'),s=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipts</title><style>${z}
  @page { size: A4; margin: 1cm; }
  .wrap { page-break-inside: avoid; }
  .copytag { text-align:right; font-size:8pt; margin:0 10px; color:#333; }
</style></head>
<body>${e}<div class="tear"></div></body></html>`;L(s,i)}function L(t,i){const e=new Blob(["\uFEFF",t],{type:"application/msword"}),s=URL.createObjectURL(e),n=document.createElement("a");n.href=s,n.download=i,n.click(),URL.revokeObjectURL(s)}function ot(t){const i=window.open("","_blank","width=860,height=900");i&&(i.document.write(A(t).replace(/^<html[^>]*>/,"<html>").replace(/<meta[^>]*>/,"")),i.document.close(),i.focus(),setTimeout(()=>i.print(),300))}function it(t){V([t])}function V(t){const e=`<html><head><title>Receipts</title><style>
  body { font-family: Arial, Helvetica, sans-serif; color:#111; margin:0; }
  .wrap { border:1.5px solid #111; padding:0; margin:0 auto; max-width:700px; page-break-inside:avoid; }
  .hdr { text-align:center; padding:14px 10px 10px; }
  .hdr h1 { font-size:15pt; margin:0; font-weight:bold; }
  .hdr p { font-size:9pt; margin:3px 0; }
  .titlebar { text-align:center; font-weight:bold; font-size:11pt; border-top:1px solid #111; border-bottom:1px solid #111; padding:6px; }
  .copytag { text-align:right; font-size:8pt; margin:2px 10px 0; color:#333; }
  .meta { width:100%; font-size:10pt; padding:10px; border-collapse:collapse; }
  .meta td { padding:3px 6px; }
  .receipt-body { padding:16px 14px; font-size:11pt; line-height:1.9; }
  .amtbox { border:1px solid #111; display:inline-block; padding:6px 14px; font-weight:bold; margin-top:14px; }
  table.sign { width:100%; }
  .cutline { border-top:2px dashed #888; margin:8px auto; max-width:700px; }
  @media print {
    body { margin: 10mm 12mm; }
    .cutline { margin: 6mm auto; }
  }
  </style></head><body>${t.map(n=>U(n)).join('<div class="cutline"></div>')}</body></html>`,s=window.open("","_blank","width=860,height=700");s&&(s.document.write(e),s.document.close(),s.focus(),setTimeout(()=>s.print(),300))}const Y={member_receipt:"Receipt Voucher",other_receipt:"Receipt Voucher",payment:"Payment Voucher",journal:"Journal Voucher"};function nt(t){return Y[t]??"Voucher"}function k(t){const i=["Code","Ledger / Particulars","Debit","Credit"],e=t.lines.map(o=>[o.code??"",[o.name.toUpperCase(),o.note?`    ${o.note}`:""].filter(Boolean).join(`
`),h(o.debit),h(o.credit)]),s=t.lines.reduce((o,l)=>o+l.debit,0),n=t.lines.reduce((o,l)=>o+l.credit,0);return e.push(["","TOTAL",h(s),h(n)]),{head:i,rows:e,totDr:s,totCr:n}}function rt(t,i){const e=new N({unit:"pt",format:"a4"}),s=e.internal.pageSize.getWidth(),n=40,o=s-n*2,l=44;D(e,t.society,l+20);let r=l+78;e.setDrawColor(60),e.setLineWidth(.8),e.line(n,r,n+o,r),r+=24,e.setFont("helvetica","bold"),e.setFontSize(13);const a=t.title.toUpperCase().split("").join(" ");e.text(a,s/2,r,{align:"center"}),e.setLineWidth(.6);const p=e.getTextWidth(a);e.line(s/2-p/2,r+4,s/2+p/2,r+4),r+=28,e.setFont("helvetica","normal"),e.setFontSize(10.5),e.text("Voucher No.:",n+8,r),e.setFont("helvetica","bold"),e.text(t.voucherNo,n+90,r),e.setFont("helvetica","normal"),e.text("Voucher Date:",s-210,r),e.text(x(t.voucherDate),s-100,r,{align:"right"}),r+=18,t.party&&(e.text(`${t.title.startsWith("Payment")?"Paid to":t.title.startsWith("Receipt")?"Received from":"Party"}:`,n+8,r),e.setFont("helvetica","bold"),e.text(t.party.toUpperCase(),n+90,r),e.setFont("helvetica","normal"),r+=18),t.chequeNo&&(e.text(`Cheque No.~ ${t.chequeNo}${t.chequeDate?`  dt ${x(t.chequeDate)}`:""}${t.bankName?`  ·  ${t.bankName}`:""}`,n+8,r),r+=18),r+=6,e.line(n,r,n+o,r),r+=16;const{head:f,rows:b}=k(t),g=n+8,u=n+70,v=n+o-190,y=n+o-10;e.setFont("helvetica","bold"),e.setFontSize(10.5),e.text(f[0],g,r),e.text(f[1],u,r),e.text(f[2],v,r,{align:"right"}),e.text(f[3],y,r,{align:"right"}),e.line(n,r+5,n+o,r+5),r+=22,e.setFont("helvetica","normal"),e.setFontSize(10);for(const d of b){e.text(String(d[0]),g,r),e.setFont("helvetica",d[1]==="TOTAL"?"bold":"normal");const $=String(d[1]).split(`
`);e.text($[0],u,r),$[1]&&(e.setFont("helvetica","normal"),e.setFontSize(8.5),e.text($[1].trim(),u+10,r+11),e.setFontSize(10)),e.setFont("helvetica",d[1]==="TOTAL"?"bold":"normal"),e.text(d[2],v,r,{align:"right"}),e.text(d[3],y,r,{align:"right"}),e.setFont("helvetica","normal"),r+=d[1].includes(`
`)?26:16}e.line(n,r-10,n+o,r-10),r+=16,e.setFont("helvetica","italic"),e.setFontSize(9.5),e.text(`Rupees: ${w(t.amount)} Only`,n+8,r,{maxWidth:o-16}),r+=26,t.narration&&(e.setFont("helvetica","normal"),e.setFontSize(9),e.text(`Narration: ${t.narration}`,n+8,r,{maxWidth:o-120}),r+=16);const m=Math.max(r+40,e.internal.pageSize.getHeight()-150);e.setFont("helvetica","bold"),e.setFontSize(9),e.text(`For ${t.society.name}`,n+o-8,m,{align:"right"}),e.setDrawColor(60),e.setLineWidth(.6),e.setLineDashPattern([2,2],0),e.line(n+10,m+40,n+o*.3,m+40),e.line(n+o*.45,m+40,n+o-10,m+40),e.setLineDashPattern([],0),e.setFont("helvetica","normal"),e.setFontSize(8),e.text("Receiver's signature",n+10,m+54),e.text("Authorised signatory",n+o*.45,m+54),e.setLineWidth(.8),e.rect(n,l,o,m+66-l),e.save(i)}function B(t){k(t);const i=t.title.startsWith("Payment")?"Paid to":t.title.startsWith("Receipt")?"Received from":"Party";return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${c(t.title)} ${c(t.voucherNo)}</title><style>${z}
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
  ${C(t.society)}
  <div class="titlebar" style="text-decoration:underline; letter-spacing:3px;">${c(t.title.toUpperCase())}</div>
  <table class="vhead">
    <tr><td>Voucher No.: <b>${c(t.voucherNo)}</b></td><td style="text-align:right">Voucher Date: ${x(t.voucherDate)}</td></tr>
    ${t.party?`<tr><td colspan="2">${c(i)}: <b>${c(t.party.toUpperCase())}</b></td></tr>`:""}
    ${t.chequeNo?`<tr><td colspan="2">Cheque No.~ <b>${c(t.chequeNo)}</b>${t.chequeDate?` dt ${x(t.chequeDate)}`:""}${t.bankName?` · ${c(t.bankName)}`:""}</td></tr>`:""}
  </table>
  <table class="vtable">
    <thead><tr><th>Code</th><th>Ledger / Particulars</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead>
    <tbody>
      ${t.lines.map(e=>`<tr><td>${c(e.code??"")}</td><td>${c(e.name.toUpperCase())}${e.note?`<br><span style="font-size:8.5pt">&nbsp;&nbsp;&nbsp;${c(e.note)}</span>`:""}</td><td class="num">${h(e.debit)}</td><td class="num">${h(e.credit)}</td></tr>`).join("")}
      <tr class="total"><td></td><td>TOTAL</td><td class="num">${h(t.lines.reduce((e,s)=>e+s.debit,0))}</td><td class="num">${h(t.lines.reduce((e,s)=>e+s.credit,0))}</td></tr>
    </tbody>
  </table>
  <div class="words">Rupees: ${c(w(t.amount))} Only</div>
  ${t.narration?`<div class="words" style="font-style:normal">Narration: ${c(t.narration)}</div>`:""}
  <table class="vsig">
    <tr>
      <td style="width:50%"><div class="sigline"></div><div style="margin-top:4px">Receiver's signature</div></td>
      <td style="width:50%; text-align:right"><b>For ${c(t.society.name)}</b><div class="sigline"></div><div style="margin-top:4px">Authorised signatory</div></td>
    </tr>
  </table>
</div><div class="tear"></div></body></html>`}function st(t,i){L(B(t),i)}function lt(t){const i=window.open("","_blank","width=860,height=800");i&&(i.document.write(B(t).replace(/^<html[^>]*>/,"<html>").replace(/<meta[^>]*>/,"")),i.document.close(),i.focus(),setTimeout(()=>i.print(),300))}export{K as a,G as b,j as c,ot as d,Q as e,tt as f,Z as g,et as h,V as i,rt as j,st as k,lt as l,X as p,it as r,nt as v};
