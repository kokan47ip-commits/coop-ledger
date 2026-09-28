import{E as S}from"./jspdf.es.min-CamLZKSb.js";import{f as x}from"./format-V6CGZsZt.js";const T=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"],j=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];function w(t){if(t<20)return T[t];const e=Math.floor(t/10),i=t%10;return j[e]+(i?` ${T[i]}`:"")}function E(t){const e=Math.floor(t/100),i=t%100,n=[];return e&&n.push(`${T[e]} Hundred`),i&&n.push(w(i)),n.join(" ")}function H(t){const e=Math.floor(Math.abs(t)),i=Math.round((Math.abs(t)-e)*100);if(e===0&&i===0)return"Zero";const n=Math.floor(e/1e7),o=Math.floor(e%1e7/1e5),s=Math.floor(e%1e5/1e3),r=e%1e3,l=[];n&&l.push(`${E(n)} Crore`),o&&l.push(`${w(o)} Lakh`),s&&l.push(`${w(s)} Thousand`),r&&l.push(E(r));let p=l.join(" ");return i>0&&(p+=`${p?" and":""} Paise ${w(i)}`),p}function F(t){return`Rupees : ${H(t)} Only`}const P=["PLEASE PAY BY CROSSED A/C. PAYEE CHEQUE ONLY.","THIS BILL IS PAYABLE ON OR BEFORE LAST DAY OF THE MONTH","LATEFEES @18% WILL BE CHARGED ON OVERDUE MONTH"];function h(t){return new Intl.NumberFormat("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}).format(t)}function tt(t){const e=["January","February","March","April","May","June","July","August","September","October","November","December"],[i,n]=t.split("-");return`${e[Number(n)-1]??n},${i}`}function I(t){return[t.name,t.registrationNo??"",t.address??""].filter(Boolean)}function C(t,e,i){const n=t.internal.pageSize.getWidth(),o=I(e);t.setFont("helvetica","bold"),t.setFontSize(13),t.text(o[0],n/2,i,{align:"center"}),t.setFont("helvetica","normal"),t.setFontSize(9);let s=i+14;for(const r of o.slice(1))t.text(r,n/2,s,{align:"center"}),s+=12;return s}function et(t,e){N(q(t),e,"application/pdf")}function N(t,e,i){const n=new Blob([t],{type:i}),o=URL.createObjectURL(n),s=document.createElement("a");s.href=o,s.download=e,document.body.appendChild(s),s.click(),s.remove(),URL.revokeObjectURL(o)}function q(t){const e=new S({unit:"pt",format:"a4"}),i=e.internal.pageSize.getWidth(),n=e.internal.pageSize.getHeight(),o=40,s=i-o*2,r=44;let l=C(e,t.society,r+20);l+=6,e.setFont("helvetica","bold"),e.setFontSize(10),e.text(`Bill for the Month of ${t.periodLabel}`,i/2,l,{align:"center"}),l+=14,e.setDrawColor(60),e.setLineWidth(.8),e.line(o,l,o+s,l),l+=16;const p=o+s*.62,c=y=>y;e.setFontSize(10),e.setFont("helvetica","normal"),e.text("Bill No:",o+6,l),e.setFont("helvetica","bold"),e.text(c(String(t.billNo)),o+70,l),e.setFont("helvetica","normal"),e.text("Bill Date:",p,l),e.text(x(t.billDate),p+60,l),l+=16,e.text("Name:",o+6,l),e.setFont("helvetica","bold"),e.text(t.memberName.toUpperCase(),o+70,l),t.memberName2&&(l+=14,e.setFont("helvetica","normal"),e.text(t.memberName2.toUpperCase(),o+70,l)),e.setFont("helvetica","normal"),e.text("Area :",p,l-(t.memberName2?14:0)),t.area&&e.text(t.area,p+60,l-(t.memberName2?14:0)),l+=16,e.text("Flat",o+6,l),e.text(t.flatNo??"",o+70,l),e.text("Due Date:",p,l),e.text(x(t.dueDate),p+60,l),l+=8;const g=l,b=o+s-120;e.line(o,l,o+s,l),l+=14,e.setFont("helvetica","bold"),e.setFontSize(10.5),e.text("P A R T I C U L A R S",o+8,l),e.text("A M O U N T",o+s-8,l,{align:"right"}),e.line(o,l+5,o+s,l+5),e.line(b,g,b,n-240),l+=20,e.setFont("helvetica","normal"),e.setFontSize(10),t.lines.forEach((y,k)=>{const M=y.serial??String(k+1);e.text(`${M}. ${y.name.toUpperCase()}`,o+14,l),e.text(h(y.amount),o+s-10,l,{align:"right"}),l+=15});const u=n-240,f=o+s*.42,v=o+s-10;e.line(o,u,o+s,u),e.line(f,u,f,u+96);let m=u+18;e.text(F(t.totalDue),o+8,m,{align:"left",maxWidth:f-o-20}),e.text("Total:",f+110,m,{align:"right"}),e.text(h(t.total),v,m,{align:"right"}),m+=18,e.text("Arrears",f+110,m,{align:"right"}),e.text(h(t.arrears),v,m,{align:"right"}),m+=22,e.setFont("helvetica","bold"),e.text("Total Due:",f+110,m,{align:"right"}),e.text(h(t.totalDue),v,m,{align:"right"}),e.setFont("helvetica","normal");const d=u+96;e.line(o,d,o+s,d);const $=o+s*.5;e.line($,d,$,d+92),e.line(o,d+92,o+s,d+92),e.line(o,r,o,d+92),e.line(o+s,r,o+s,d+92),e.line(o,r,o+s,r),e.setFontSize(8);let R=d+16;for(const y of P)e.text(y,o+6,R),R+=12;return e.setFont("helvetica","bold"),e.setFontSize(9),e.text(`For ${t.society.name}`,o+s-8,d+16,{align:"right"}),e.setFont("helvetica","normal"),e.setFontSize(8),e.text("SECRETARY",o+s-8,d+78,{align:"right"}),e.setDrawColor(120),e.setLineDashPattern([6,4],0),e.line(o,d+120,o+s,d+120),e.setLineDashPattern([],0),new Uint8Array(e.output("arraybuffer"))}function A(t,e,i,n,o){const s=n;C(t,e.society,s+22),e.copyLabel&&(t.setFont("helvetica","normal"),t.setFontSize(8),t.setTextColor(90),t.text(e.copyLabel.toUpperCase(),i+o-8,s+12,{align:"right"}),t.setTextColor(30));let r=s+78;t.setDrawColor(60),t.setLineWidth(.8),t.line(i,r,i+o,r),r+=26,t.setFont("helvetica","bold"),t.setFontSize(13),t.text("R E C E I P T",i+o/2,r,{align:"center"}),t.setLineWidth(.6);const l=t.getTextWidth("R E C E I P T");t.line(i+o/2-l/2,r+4,i+o/2+l/2,r+4),r+=30,t.setFont("helvetica","normal"),t.setFontSize(10.5),t.text("Receipt No.:",i+8,r),t.text(String(e.receiptNo),i+90,r),t.text("Receipt Date:",i+o-150,r),t.text(x(e.receiptDate),i+o-60,r,{align:"right"}),r+=22,t.line(i,r,i+o,r),r+=26;const p=[{pre:"Received with thanks from ",bold:e.memberName.toUpperCase()},{pre:"the sum of ",bold:`Rs. ${h(e.amount)}/-`,post:" in words ",underline:!0}];let c=r;for(const b of p){t.setFont("helvetica","normal"),b.pre&&t.text(b.pre,i+12,c);const u=b.pre?t.getTextWidth(b.pre):0;if(t.setFont("helvetica","bold"),t.text(b.bold??"",i+12+u,c),b.underline){const f=t.getTextWidth(b.bold??"");t.setLineWidth(.5),t.line(i+12+u,c+2.5,i+12+u+f,c+2.5),t.setFont("helvetica","normal"),t.setFontSize(9),t.text(F(e.amount),i+12+u+f+24,c),t.setFontSize(10.5)}c+=20}t.setFont("helvetica","normal"),t.text(`in Part/Full Payment of ${e.purpose}`,i+12,c),c+=20;const g=[e.reference,e.mode].filter(Boolean).join(" · ");return t.text(`being the charges for the Flat ${e.flatNo??"—"}${g?`   Cheque No.~ ${g}`:""}`,i+12,c),c+=34,t.setLineWidth(.8),t.rect(i+12,c,170,30),t.setFont("helvetica","bold"),t.setFontSize(11),t.text(`Rs. ${h(e.amount)} /-`,i+22,c+19),t.setFont("helvetica","normal"),t.setFontSize(7.5),t.text("*Subject to realisation of cheque(s).",i+12,c+42),t.setFont("helvetica","bold"),t.setFontSize(9),t.text(`For ${e.society.name}`,i+o-8,c+6,{align:"right"}),t.setFont("helvetica","normal"),t.setFontSize(8),t.text("SECRETARY",i+o-8,c+62,{align:"right"}),t.setLineWidth(.8),t.rect(i,s,o,c+70-s),c+70}function V(t){const e=new S({unit:"pt",format:"a4"}),i=e.internal.pageSize.getWidth(),n=40,o=i-n*2,s=A(e,t,n,60,o);return e.setDrawColor(120),e.setLineDashPattern([6,4],0),e.line(n,s+30,n+o,s+30),e.setLineDashPattern([],0),new Uint8Array(e.output("arraybuffer"))}function ot(t,e){N(V(t),e,"application/pdf")}function it(t,e,i=!1){N(Y(t,i),e,"application/pdf")}function Y(t,e=!1){const i=new S({unit:"pt",format:"a4"}),n=i.internal.pageSize.getWidth(),o=40,s=n-o*2,r=e?2:1,l=g=>e?g===0?50:421:60;let p=0,c=0;for(const g of t){if(p>=r&&(i.addPage(),p=0),e&&p===1){const b=Math.round((c+l(1))/2);i.setDrawColor(120),i.setLineDashPattern([6,4],0),i.line(o,b,o+s,b),i.setLineDashPattern([],0)}c=A(i,{...g.data,copyLabel:g.copyLabel??g.data.copyLabel},o,l(p),s),p++}return new Uint8Array(i.output("arraybuffer"))}function nt(t){let e="";for(let n=0;n<t.length;n+=8192){let o="";for(let s=n;s<Math.min(n+8192,t.length);s++)o+=String.fromCharCode(t[s]??0);e+=o}return btoa(e)}const L=`
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
`;function D(t){return`<div class="hdr">
    <h1>${a(t.name.toUpperCase())}</h1>
    ${t.registrationNo?`<p>${a(t.registrationNo)}</p>`:""}
    ${t.address?`<p>${a(t.address)}</p>`:""}
  </div>`}function a(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function W(t){return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Bill ${a(String(t.billNo))}</title><style>${L}</style></head>
<body><div class="wrap">
  ${D(t.society)}
  <div class="titlebar">Bill for the Month of ${a(t.periodLabel)}</div>
  <table class="meta">
    <tr><td>Bill No:</td><td><b>${a(String(t.billNo))}</b></td><td style="text-align:right">Bill Date:</td><td>${x(t.billDate)}</td></tr>
    <tr><td>Name:</td><td><b>${a(t.memberName.toUpperCase())}</b>${t.memberName2?`<br>${a(t.memberName2.toUpperCase())}`:""}</td><td style="text-align:right">Area :</td><td>${a(t.area??"")}</td></tr>
    <tr><td>Flat</td><td>${a(t.flatNo??"")}</td><td style="text-align:right">Due Date:</td><td>${x(t.dueDate)}</td></tr>
  </table>
  <table class="parthead"><tr><th>PARTICULARS</th><th class="r">AMOUNT</th></tr></table>
  <table class="lines">
    ${t.lines.map((e,i)=>`<tr><td>${e.serial??i+1}.&nbsp; ${a(e.name.toUpperCase())}</td><td class="num">${h(e.amount)}</td></tr>`).join("")}
    ${Array.from({length:Math.max(0,6-t.lines.length)},()=>"<tr><td>&nbsp;</td><td></td></tr>").join("")}
  </table>
  <table class="tot">
    <tr><td rowspan="2" style="width:55%">${a(F(t.totalDue))}</td><td class="lbl">Total:</td><td class="val">${h(t.total)}</td></tr>
    <tr><td class="lbl">Arrears</td><td class="val">${h(t.arrears)}</td></tr>
    <tr><td></td><td class="lbl grand">Total Due:</td><td class="val grand">${h(t.totalDue)}</td></tr>
  </table>
  <table class="foot">
    <tr><td style="width:50%">${P.map(a).join("<br>")}</td>
    <td class="sig">For ${a(t.society.name)}<br><br><br><span style="font-weight:normal">SECRETARY</span></td></tr>
  </table>
</div><div class="tear"></div></body></html>`}function rt(t,e){z(W(t),e)}function U(t){return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipt ${a(String(t.receiptNo))}</title><style>${L}</style></head>
<body><div class="wrap">
  ${D(t.society)}
  <div class="titlebar" style="text-decoration:underline; letter-spacing:3px;">RECEIPT</div>
  ${t.copyLabel?`<p class="copytag">${a(t.copyLabel.toUpperCase())}</p>`:""}
  <table class="meta">
    <tr><td>Receipt No.:</td><td>${a(String(t.receiptNo))}</td><td style="text-align:right">Receipt Date:</td><td>${x(t.receiptDate)}</td></tr>
  </table>
  <div class="receipt-body">
    Received with thanks from <b>${a(t.memberName.toUpperCase())}</b><br>
    the sum of <b>Rs. ${h(t.amount)}/-</b> in words <b><u>${a(F(t.amount))}</u></b><br>
    in Part/Full Payment of ${a(t.purpose)}<br>
    being the charges for the Flat ${a(t.flatNo??"—")}${t.reference?` &nbsp;<b>Cheque No.~ ${a(t.reference)}</b>`:""}
    <table class="sign"><tr>
      <td><span class="amtbox">Rs. ${h(t.amount)} /-</span><br><span style="font-size:7.5pt">*Subject to realisation of cheque(s).</span></td>
      <td style="text-align:right; vertical-align:top"><b>For ${a(t.society.name)}</b><br><br><br><span style="font-weight:normal">SECRETARY</span></td>
    </tr></table>
  </div>
</div><div class="tear"></div></body></html>`}function st(t,e){z(U(t),e)}function _(t){const e=U(t),i=e.indexOf("<body>"),n=e.lastIndexOf("</body>");return i<0||n<0?e:e.slice(i+6,n)}function O(t){return _(t).replace(/<div class="tear"><\/div>\s*$/,"")}function lt(t,e){const i=t.map(o=>O({...o.data,copyLabel:o.copyLabel??o.data.copyLabel})).join('<div class="tear"></div>'),n=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipts</title><style>${L}
  @page { size: A4; margin: 1cm; }
  .wrap { page-break-inside: avoid; }
  .copytag { text-align:right; font-size:8pt; margin:0 10px; color:#333; }
</style></head>
<body>${i}<div class="tear"></div></body></html>`;z(n,e)}function z(t,e){const i=new Blob(["\uFEFF",t],{type:"application/msword"}),n=URL.createObjectURL(i),o=document.createElement("a");o.href=n,o.download=e,o.click(),URL.revokeObjectURL(n)}function at(t){const e=window.open("","_blank","width=860,height=900");e&&(e.document.write(W(t).replace(/^<html[^>]*>/,"<html>").replace(/<meta[^>]*>/,"")),e.document.close(),e.focus(),setTimeout(()=>e.print(),300))}function ct(t){J([t])}function J(t){const i=`<html><head><title>Receipts</title><style>
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
  </style></head><body>${t.map(o=>O(o)).join('<div class="cutline"></div>')}</body></html>`,n=window.open("","_blank","width=860,height=700");n&&(n.document.write(i),n.document.close(),n.focus(),setTimeout(()=>n.print(),300))}const X={member_receipt:"Receipt Voucher",other_receipt:"Receipt Voucher",payment:"Payment Voucher",journal:"Journal Voucher"};function pt(t){return X[t]??"Voucher"}function G(t){const e=["Code","Ledger / Particulars","Debit","Credit"],i=t.lines.map(s=>[s.code??"",[s.name.toUpperCase(),s.note?`    ${s.note}`:""].filter(Boolean).join(`
`),h(s.debit),h(s.credit)]),n=t.lines.reduce((s,r)=>s+r.debit,0),o=t.lines.reduce((s,r)=>s+r.credit,0);return i.push(["","TOTAL",h(n),h(o)]),{head:e,rows:i,totDr:n,totCr:o}}function Q(t){const e=new S({unit:"pt",format:"a4"}),i=e.internal.pageSize.getWidth(),n=40,o=i-n*2,s=44;C(e,t.society,s+20);let r=s+78;e.setDrawColor(60),e.setLineWidth(.8),e.line(n,r,n+o,r),r+=24,e.setFont("helvetica","bold"),e.setFontSize(13);const l=t.title.toUpperCase().split("").join(" ");e.text(l,i/2,r,{align:"center"}),e.setLineWidth(.6);const p=e.getTextWidth(l);e.line(i/2-p/2,r+4,i/2+p/2,r+4),r+=28,e.setFont("helvetica","normal"),e.setFontSize(10.5),e.text("Voucher No.:",n+8,r),e.setFont("helvetica","bold"),e.text(t.voucherNo,n+90,r),e.setFont("helvetica","normal"),e.text("Voucher Date:",i-210,r),e.text(x(t.voucherDate),i-100,r,{align:"right"}),r+=18,t.party&&(e.text(`${t.title.startsWith("Payment")?"Paid to":t.title.startsWith("Receipt")?"Received from":"Party"}:`,n+8,r),e.setFont("helvetica","bold"),e.text(t.party.toUpperCase(),n+90,r),e.setFont("helvetica","normal"),r+=18),t.chequeNo&&(e.text(`Cheque No.~ ${t.chequeNo}${t.chequeDate?`  dt ${x(t.chequeDate)}`:""}${t.bankName?`  ·  ${t.bankName}`:""}`,n+8,r),r+=18),r+=6,e.line(n,r,n+o,r),r+=16;const{head:c,rows:g}=G(t),b=n+8,u=n+70,f=n+o-190,v=n+o-10;e.setFont("helvetica","bold"),e.setFontSize(10.5),e.text(c[0],b,r),e.text(c[1],u,r),e.text(c[2],f,r,{align:"right"}),e.text(c[3],v,r,{align:"right"}),e.line(n,r+5,n+o,r+5),r+=22,e.setFont("helvetica","normal"),e.setFontSize(10);for(const d of g){e.text(String(d[0]),b,r),e.setFont("helvetica",d[1]==="TOTAL"?"bold":"normal");const $=String(d[1]).split(`
`);e.text($[0],u,r),$[1]&&(e.setFont("helvetica","normal"),e.setFontSize(8.5),e.text($[1].trim(),u+10,r+11),e.setFontSize(10)),e.setFont("helvetica",d[1]==="TOTAL"?"bold":"normal"),e.text(d[2],f,r,{align:"right"}),e.text(d[3],v,r,{align:"right"}),e.setFont("helvetica","normal"),r+=d[1].includes(`
`)?26:16}e.line(n,r-10,n+o,r-10),r+=16,e.setFont("helvetica","italic"),e.setFontSize(9.5),e.text(`Rupees: ${F(t.amount)} Only`,n+8,r,{maxWidth:o-16}),r+=26,t.narration&&(e.setFont("helvetica","normal"),e.setFontSize(9),e.text(`Narration: ${t.narration}`,n+8,r,{maxWidth:o-120}),r+=16);const m=Math.max(r+40,e.internal.pageSize.getHeight()-150);return e.setFont("helvetica","bold"),e.setFontSize(9),e.text(`For ${t.society.name}`,n+o-8,m,{align:"right"}),e.setDrawColor(60),e.setLineWidth(.6),e.setLineDashPattern([2,2],0),e.line(n+10,m+40,n+o*.3,m+40),e.line(n+o*.45,m+40,n+o-10,m+40),e.setLineDashPattern([],0),e.setFont("helvetica","normal"),e.setFontSize(8),e.text("Receiver's signature",n+10,m+54),e.text("Authorised signatory",n+o*.45,m+54),e.setLineWidth(.8),e.rect(n,s,o,m+66-s),new Uint8Array(e.output("arraybuffer"))}function dt(t,e){N(Q(t),e,"application/pdf")}function B(t){const e=t.title.startsWith("Payment")?"Paid to":t.title.startsWith("Receipt")?"Received from":"Party";return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${a(t.title)} ${a(t.voucherNo)}</title><style>${L}
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
  ${D(t.society)}
  <div class="titlebar" style="text-decoration:underline; letter-spacing:3px;">${a(t.title.toUpperCase())}</div>
  <table class="vhead">
    <tr><td>Voucher No.: <b>${a(t.voucherNo)}</b></td><td style="text-align:right">Voucher Date: ${x(t.voucherDate)}</td></tr>
    ${t.party?`<tr><td colspan="2">${a(e)}: <b>${a(t.party.toUpperCase())}</b></td></tr>`:""}
    ${t.chequeNo?`<tr><td colspan="2">Cheque No.~ <b>${a(t.chequeNo)}</b>${t.chequeDate?` dt ${x(t.chequeDate)}`:""}${t.bankName?` · ${a(t.bankName)}`:""}</td></tr>`:""}
  </table>
  <table class="vtable">
    <thead><tr><th>Code</th><th>Ledger / Particulars</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead>
    <tbody>
      ${t.lines.map(i=>`<tr><td>${a(i.code??"")}</td><td>${a(i.name.toUpperCase())}${i.note?`<br><span style="font-size:8.5pt">&nbsp;&nbsp;&nbsp;${a(i.note)}</span>`:""}</td><td class="num">${h(i.debit)}</td><td class="num">${h(i.credit)}</td></tr>`).join("")}
      <tr class="total"><td></td><td>TOTAL</td><td class="num">${h(t.lines.reduce((i,n)=>i+n.debit,0))}</td><td class="num">${h(t.lines.reduce((i,n)=>i+n.credit,0))}</td></tr>
    </tbody>
  </table>
  <div class="words">Rupees: ${a(F(t.amount))} Only</div>
  ${t.narration?`<div class="words" style="font-style:normal">Narration: ${a(t.narration)}</div>`:""}
  <table class="vsig">
    <tr>
      <td style="width:50%"><div class="sigline"></div><div style="margin-top:4px">Receiver's signature</div></td>
      <td style="width:50%; text-align:right"><b>For ${a(t.society.name)}</b><div class="sigline"></div><div style="margin-top:4px">Authorised signatory</div></td>
    </tr>
  </table>
</div><div class="tear"></div></body></html>`}function ht(t,e){z(B(t),e)}function mt(t){const e=window.open("","_blank","width=860,height=800");e&&(e.document.write(B(t).replace(/^<html[^>]*>/,"<html>").replace(/<meta[^>]*>/,"")),e.document.close(),e.focus(),setTimeout(()=>e.print(),300))}export{rt as a,et as b,nt as c,q as d,H as e,at as f,ot as g,st as h,it as i,lt as j,J as k,V as l,Q as m,dt as n,ht as o,tt as p,mt as q,ct as r,pt as v};
