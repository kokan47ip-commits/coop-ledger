import{E as V}from"./jspdf.es.min-BRQEMuym.js";import{f as D}from"./format-V6CGZsZt.js";const K=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"],ct=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];function j(e){if(e<20)return K[e];const t=Math.floor(e/10),n=e%10;return ct[t]+(n?` ${K[n]}`:"")}function tt(e){const t=Math.floor(e/100),n=e%100,s=[];return t&&s.push(`${K[t]} Hundred`),n&&s.push(j(n)),s.join(" ")}function pt(e){const t=Math.floor(Math.abs(e)),n=Math.round((Math.abs(e)-t)*100);if(t===0&&n===0)return"Zero";const s=Math.floor(t/1e7),o=Math.floor(t%1e7/1e5),i=Math.floor(t%1e5/1e3),p=t%1e3,b=[];s&&b.push(`${tt(s)} Crore`),o&&b.push(`${j(o)} Lakh`),i&&b.push(`${j(i)} Thousand`),p&&b.push(tt(p));let y=b.join(" ");return n>0&&(y+=`${y?" and":""} Paise ${j(n)}`),y}function I(e){return`Rupees : ${pt(e)} Only`}const et=["PLEASE PAY BY CROSSED A/C. PAYEE CHEQUE ONLY.","THIS BILL IS PAYABLE ON OR BEFORE LAST DAY OF THE MONTH","LATEFEES @18% WILL BE CHARGED ON OVERDUE MONTH"];function u(e){return new Intl.NumberFormat("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}).format(e)}function Ft(e){const t=["January","February","March","April","May","June","July","August","September","October","November","December"],[n,s]=e.split("-");return`${t[Number(s)-1]??s},${n}`}const h=[15,23,42],f=[100,116,139],g=[49,46,129],W=[238,242,255],M=[248,250,252],ot=[180,83,9],z=[203,213,225],q=[255,255,255];function x(e,t){e.setFillColor(t[0],t[1],t[2])}function $(e,t){e.setDrawColor(t[0],t[1],t[2])}function r(e,t){e.setTextColor(t[0],t[1],t[2])}function Q(e,t,n,s,o){x(e,g),e.rect(n,o,s,76,"F"),x(e,ot),e.rect(n,o+76,s,3,"F");const p=n+s/2;r(e,q),e.setFont("helvetica","bold"),e.setFontSize(15),e.text(t.name.toUpperCase(),p,o+31,{align:"center",maxWidth:s-36}),r(e,[199,210,254]),e.setFont("helvetica","normal"),e.setFontSize(8.6);let b=o+47;for(const y of[t.registrationNo,t.address].filter(Boolean))e.text(y,p,b,{align:"center",maxWidth:s-44}),b+=11;return r(e,h),o+76+3}function $t(e,t){Y(ht(e),t,"application/pdf")}function Y(e,t,n){const s=new Blob([e],{type:n}),o=URL.createObjectURL(s),i=document.createElement("a");i.href=o,i.download=t,document.body.appendChild(i),i.click(),i.remove(),URL.revokeObjectURL(o)}function ht(e){const t=new V({unit:"pt",format:"a4"}),n=t.internal.pageSize.getWidth(),s=t.internal.pageSize.getHeight(),o=38,i=n-o*2,p=30,b=68,y=84,c=s-138,m=c-b,l=m-y,S=o+i*.56,L=o+i-12;let d=Q(t,e.society,o,i,p)+22;x(t,W),t.rect(o,d,i,26,"F"),r(t,g),t.setFont("helvetica","bold"),t.setFontSize(11.5),t.text(`BILL FOR THE MONTH OF ${e.periodLabel.toUpperCase()}`,o+i/2,d+17.5,{align:"center"}),r(t,h),d+=44;const P=o+i*.6,R=d+20,A=R+24,B=A+(e.memberName2?15:0)+24,C=B-d+18;x(t,M),$(t,z),t.setLineWidth(.6),t.rect(o,d,i,C,"FD");const N=(F,T,E,at=!1)=>{t.setFont("helvetica","normal"),t.setFontSize(9.5),r(t,f),t.text(F,o+12,E),t.setFont("helvetica",at?"bold":"normal"),r(t,h),t.text(T,o+66,E,{maxWidth:P-o-78})},U=(F,T,E)=>{t.setFont("helvetica","normal"),t.setFontSize(9.5),r(t,f),t.text(F,P,E),r(t,h),t.text(T,L,E,{align:"right"})};N("Bill No:",String(e.billNo),R,!0),U("Bill Date:",D(e.billDate),R),N("Name:",e.memberName.toUpperCase(),A,!0),e.memberName2&&(t.setFont("helvetica","normal"),r(t,h),t.text(e.memberName2.toUpperCase(),o+66,A+14,{maxWidth:P-o-78})),U("Area :",e.area??"—",A),N("Flat",e.flatNo??"—",B),U("Due Date:",D(e.dueDate),B),d+=C+18,x(t,g),t.rect(o,d,i,22,"F"),r(t,q),t.setFont("helvetica","bold"),t.setFontSize(10),t.text("P A R T I C U L A R S",o+12,d+15),t.text("A M O U N T",o+i-12,d+15,{align:"right"}),r(t,h),d+=22;const G=d,H=o+i-122,O=Math.max(e.lines.length,1),w=Math.max(12,Math.min(17,Math.floor((l-d)/O)));t.setFont("helvetica","normal"),t.setFontSize(10),e.lines.forEach((F,T)=>{T%2===1&&(x(t,M),t.rect(o,d,i,w,"F"));const E=F.serial??String(T+1);r(t,h),t.text(`${E}. ${F.name.toUpperCase()}`,o+12,d+w-5,{maxWidth:H-o-24}),t.text(u(F.amount),o+i-12,d+w-5,{align:"right"}),d+=w});for(let F=e.lines.length;d+w<=l;F++)F%2===1&&(x(t,M),t.rect(o,d,i,w,"F")),d+=w;$(t,W),t.setLineWidth(.6),t.line(H,G,H,l),$(t,z),t.line(o,l,o+i,l);let v=l+17;t.setFont("helvetica","italic"),t.setFontSize(8.6),r(t,f),t.text(I(e.totalDue),o+12,v,{maxWidth:S-o-30}),t.setFont("helvetica","normal"),t.setFontSize(10),t.text("Total:",S,v,{align:"right"}),r(t,h),t.text(u(e.total),L,v,{align:"right"}),v+=17,r(t,f),t.text("Arrears:",S,v,{align:"right"}),r(t,h),t.text(u(e.arrears),L,v,{align:"right"}),v+=21,x(t,g),t.rect(S-16,v-15,L-S+28,23,"F"),r(t,q),t.setFont("helvetica","bold"),t.setFontSize(10.5),t.text("Total Due:",S,v+1.5,{align:"right"}),t.text(u(e.totalDue),L,v+1.5,{align:"right"}),r(t,h),t.setFont("helvetica","normal"),x(t,M),t.rect(o,m,i,b,"F"),$(t,z),t.setLineWidth(.6),t.line(o,m,o+i,m),t.line(o+i*.52,m,o+i*.52,c),t.setFont("helvetica","normal"),t.setFontSize(7.6),r(t,f);let k=m+19;for(const F of et)t.text(F,o+12,k),k+=12;return t.setFont("helvetica","bold"),t.setFontSize(9),r(t,g),t.text(`For ${e.society.name}`,o+i-12,m+19,{align:"right"}),$(t,z),t.setLineDashPattern([2,2],0),t.line(o+i*.62,m+42,o+i-12,m+42),t.setLineDashPattern([],0),t.setFont("helvetica","normal"),t.setFontSize(8),r(t,f),t.text("SECRETARY",o+i-12,m+54,{align:"right"}),$(t,g),t.setLineWidth(1),t.rect(o,p,i,c-p),$(t,z),t.setLineWidth(.8),t.setLineDashPattern([5,4],0),t.line(o,c+30,o+i,c+30),t.setLineDashPattern([],0),new Uint8Array(t.output("arraybuffer"))}function nt(e,t,n,s,o){const i=s;let p=Q(e,t.society,n,o,i)+20;t.copyLabel&&(e.setFont("helvetica","normal"),e.setFontSize(7.6),r(e,f),e.text(t.copyLabel.toUpperCase(),n+o-12,p,{align:"right"}),p+=14),e.setFont("helvetica","bold"),e.setFontSize(13.5),r(e,g);const b="R E C E I P T";e.text(b,n+o/2,p+10,{align:"center"});const y=e.getTextWidth(b);x(e,ot),e.rect(n+o/2-y/2,p+15,y,2,"F"),r(e,h),p+=30,x(e,W),e.rect(n,p,o,22,"F"),e.setFont("helvetica","normal"),e.setFontSize(9.5),r(e,f),e.text("Receipt No.:",n+12,p+15),r(e,h),e.setFont("helvetica","bold"),e.text(String(t.receiptNo),n+84,p+15),e.setFont("helvetica","normal"),r(e,f),e.text("Receipt Date:",n+o-168,p+15),r(e,h),e.text(D(t.receiptDate),n+o-12,p+15,{align:"right"}),p+=46;let c=p;e.setFontSize(10.5),e.setFont("helvetica","normal"),r(e,f),e.text("Received with thanks from",n+16,c),e.setFont("helvetica","bold"),r(e,h),e.text(t.memberName.toUpperCase(),n+158,c,{maxWidth:n+o-20-(n+158)}),c+=20,e.setFont("helvetica","normal"),r(e,f),e.text("the sum of",n+16,c),e.setFont("helvetica","bold"),r(e,g),e.text(`Rs. ${u(t.amount)}/-`,n+78,c),e.setFont("helvetica","normal"),r(e,f),e.text("in words",n+180,c),c+=8,x(e,W),e.rect(n+16,c,o-32,20,"F"),e.setFont("helvetica","italic"),e.setFontSize(9.2),r(e,g),e.text(I(t.amount),n+24,c+13.5,{maxWidth:o-48}),c+=34,e.setFont("helvetica","normal"),e.setFontSize(10.5),r(e,f),e.text("in Part/Full Payment of",n+16,c),r(e,h),e.text(t.purpose,n+162,c,{maxWidth:n+o-20-(n+162)}),c+=20,r(e,f),e.text("being the charges for the Flat",n+16,c),r(e,h);const m=[t.reference,t.mode].filter(Boolean).join(" · ");e.text(`${t.flatNo??"—"}${m?`   Cheque No.~ ${m}`:""}`,n+176,c,{maxWidth:n+o-20-(n+176)}),c+=36;const l=178;x(e,W),$(e,g),e.setLineWidth(1),e.rect(n+16,c-14,l,30,"FD"),e.setFont("helvetica","bold"),e.setFontSize(11.5),r(e,g);const S=`Rs. ${u(t.amount)} /-`;e.text(S,n+16+(l-e.getTextWidth(S))/2,c+5),e.setFont("helvetica","normal"),e.setFontSize(7.4),r(e,f),e.text("*Subject to realisation of cheque(s).",n+16,c+28),e.setFont("helvetica","bold"),e.setFontSize(9),r(e,g),e.text(`For ${t.society.name}`,n+o-12,c,{align:"right"}),$(e,z),e.setLineWidth(.6),e.setLineDashPattern([2,2],0),e.line(n+o-168,c+34,n+o-12,c+34),e.setLineDashPattern([],0),e.setFont("helvetica","normal"),e.setFontSize(8),r(e,f),e.text("SECRETARY",n+o-12,c+46,{align:"right"});const L=c+66;return $(e,g),e.setLineWidth(1),e.rect(n,i,o,L-i),L}function dt(e){const t=new V({unit:"pt",format:"a4"}),n=t.internal.pageSize.getWidth(),s=38,o=n-s*2,i=nt(t,e,s,56,o);return $(t,z),t.setLineWidth(.8),t.setLineDashPattern([5,4],0),t.line(s,i+30,s+o,i+30),t.setLineDashPattern([],0),new Uint8Array(t.output("arraybuffer"))}function wt(e,t){Y(dt(e),t,"application/pdf")}function Lt(e,t,n=!1){Y(ft(e,n),t,"application/pdf")}function ft(e,t=!1){const n=new V({unit:"pt",format:"a4"}),s=n.internal.pageSize.getWidth(),o=38,i=s-o*2,p=t?2:1,b=m=>t?m===0?44:424:56;let y=0,c=0;for(const m of e){if(y>=p&&(n.addPage(),y=0),t&&y===1){const l=Math.round((c+b(1))/2);$(n,z),n.setLineWidth(.8),n.setLineDashPattern([5,4],0),n.line(o,l,o+i,l),n.setLineDashPattern([],0)}c=nt(n,{...m.data,copyLabel:m.copyLabel??m.data.copyLabel},o,b(y),i),y++}return new Uint8Array(n.output("arraybuffer"))}function St(e){let t="";for(let s=0;s<e.length;s+=8192){let o="";for(let i=s;i<Math.min(s+8192,e.length);i++)o+=String.fromCharCode(e[i]??0);t+=o}return btoa(t)}const _=`
  body { font-family: Arial, Helvetica, sans-serif; color:#0f172a; margin:0; background:#ffffff; }
  .wrap { border:1.2pt solid #312e81; border-radius:6px; margin:0 auto; max-width:720px; overflow:hidden; background:#ffffff; }
  .hdr { text-align:center; padding:16px 12px 14px; background:#312e81; }
  .hdr h1 { font-size:15pt; margin:0; font-weight:bold; color:#ffffff; letter-spacing:0.4pt; }
  .hdr p { font-size:8.5pt; margin:3px 0 0; color:#c7d2fe; }
  .goldrule { height:3px; background:#b45309; }
  .titlebar { text-align:center; font-weight:bold; font-size:11pt; background:#eef2ff; color:#312e81; padding:7px; letter-spacing:1.5px; }
  .meta { width:100%; font-size:10pt; border-collapse:collapse; background:#f8fafc; border-bottom:1px solid #e2e8f0; }
  .meta td { padding:5px 8px; }
  .parthead { width:100%; border-collapse:collapse; }
  .parthead th { background:#312e81; color:#ffffff; font-size:10pt; padding:7px 10px; text-align:left; letter-spacing:2px; border:0; }
  .parthead th.r { text-align:right; }
  .lines { width:100%; border-collapse:collapse; }
  .lines td { font-size:10pt; padding:5px 10px; border-bottom:1px solid #eef2ff; }
  .lines tr:nth-child(even) td { background:#f8fafc; }
  .lines td.num { text-align:right; }
  .tot { width:100%; border-collapse:collapse; border-top:1px solid #cbd5e1; }
  .tot td { font-size:10pt; padding:5px 10px; }
  .tot .words { font-style:italic; color:#64748b; font-size:9pt; }
  .tot .lbl { text-align:right; }
  .tot .val { text-align:right; width:120px; }
  .tot tr.grand td { background:#312e81; color:#ffffff; font-weight:bold; }
  .foot { width:100%; border-top:1px solid #cbd5e1; font-size:8pt; border-collapse:collapse; background:#f8fafc; }
  .foot td { padding:10px; vertical-align:top; color:#64748b; }
  .foot .sig { text-align:right; font-weight:bold; font-size:9pt; color:#312e81; }
  .foot .sigspan { font-weight:normal; color:#64748b; }
  .receipt-body { padding:18px 16px; font-size:10.5pt; line-height:1.9; }
  .wordband { background:#eef2ff; color:#312e81; font-style:italic; font-size:9.5pt; padding:5px 10px; margin:8px 0; }
  .amtbox { background:#eef2ff; border:1pt solid #312e81; color:#312e81; display:inline-block; padding:7px 16px; font-weight:bold; margin-top:14px; }
  .tear { border-bottom:2px dashed #94a3b8; margin:26px auto; max-width:720px; }
  .copytag { text-align:right; font-size:8pt; margin:6px 12px 0; color:#64748b; letter-spacing:1px; }
  table.sign { width:100%; }
  .vsig td { vertical-align:top; }
`;function Z(e){return`<div class="hdr">
    <h1>${a(e.name.toUpperCase())}</h1>
    ${e.registrationNo?`<p>${a(e.registrationNo)}</p>`:""}
    ${e.address?`<p>${a(e.address)}</p>`:""}
  </div><div class="goldrule"></div>`}function a(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function it(e){return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Bill ${a(String(e.billNo))}</title><style>${_}</style></head>
<body><div class="wrap">
  ${Z(e.society)}
  <div class="titlebar">BILL FOR THE MONTH OF ${a(e.periodLabel.toUpperCase())}</div>
  <table class="meta">
    <tr><td style="color:#64748b">Bill No:</td><td><b>${a(String(e.billNo))}</b></td><td style="text-align:right;color:#64748b">Bill Date:</td><td style="text-align:right">${D(e.billDate)}</td></tr>
    <tr><td style="color:#64748b">Name:</td><td><b>${a(e.memberName.toUpperCase())}</b>${e.memberName2?`<br>${a(e.memberName2.toUpperCase())}`:""}</td><td style="text-align:right;color:#64748b">Area :</td><td style="text-align:right">${a(e.area??"")}</td></tr>
    <tr><td style="color:#64748b">Flat</td><td>${a(e.flatNo??"")}</td><td style="text-align:right;color:#64748b">Due Date:</td><td style="text-align:right">${D(e.dueDate)}</td></tr>
  </table>
  <table class="parthead"><tr><th>P A R T I C U L A R S</th><th class="r">A M O U N T</th></tr></table>
  <table class="lines">
    ${e.lines.map((t,n)=>`<tr><td>${t.serial??n+1}.&nbsp; ${a(t.name.toUpperCase())}</td><td class="num">${u(t.amount)}</td></tr>`).join("")}
    ${Array.from({length:Math.max(0,7-e.lines.length)},()=>"<tr><td>&nbsp;</td><td></td></tr>").join("")}
  </table>
  <table class="tot">
    <tr><td class="words" rowspan="2" style="width:52%">${a(I(e.totalDue))}</td><td class="lbl">Total:</td><td class="val">${u(e.total)}</td></tr>
    <tr><td class="lbl">Arrears:</td><td class="val">${u(e.arrears)}</td></tr>
    <tr class="grand"><td></td><td class="lbl">Total Due:</td><td class="val">${u(e.totalDue)}</td></tr>
  </table>
  <table class="foot">
    <tr><td style="width:50%">${et.map(a).join("<br>")}</td>
    <td class="sig">For ${a(e.society.name)}<br><br><br><span class="sigspan">SECRETARY</span></td></tr>
  </table>
</div><div class="tear"></div></body></html>`}function zt(e,t){J(it(e),t)}function rt(e){return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipt ${a(String(e.receiptNo))}</title><style>${_}</style></head>
<body><div class="wrap">
  ${Z(e.society)}
  <div class="titlebar" style="letter-spacing:4px;">RECEIPT</div>
  ${e.copyLabel?`<p class="copytag">${a(e.copyLabel.toUpperCase())}</p>`:""}
  <table class="meta">
    <tr><td style="color:#64748b">Receipt No.:</td><td><b>${a(String(e.receiptNo))}</b></td><td style="text-align:right;color:#64748b">Receipt Date:</td><td style="text-align:right">${D(e.receiptDate)}</td></tr>
  </table>
  <div class="receipt-body">
    <span style="color:#64748b">Received with thanks from</span> <b>${a(e.memberName.toUpperCase())}</b><br>
    <span style="color:#64748b">the sum of</span> <b style="color:#312e81">Rs. ${u(e.amount)}/-</b> <span style="color:#64748b">in words</span>
    <div class="wordband">${a(I(e.amount))}</div>
    <span style="color:#64748b">in Part/Full Payment of</span> ${a(e.purpose)}<br>
    <span style="color:#64748b">being the charges for the Flat</span> ${a(e.flatNo??"—")}${e.reference?` &nbsp;<b>Cheque No.~ ${a(e.reference)}</b>`:""}
    <table class="sign"><tr>
      <td style="vertical-align:top"><span class="amtbox">Rs. ${u(e.amount)} /-</span><br><span style="font-size:7.5pt;color:#64748b">*Subject to realisation of cheque(s).</span></td>
      <td style="text-align:right; vertical-align:top"><b style="color:#312e81">For ${a(e.society.name)}</b><br><br><br><span style="font-weight:normal;color:#64748b">SECRETARY</span></td>
    </tr></table>
  </div>
</div><div class="tear"></div></body></html>`}function Nt(e,t){J(rt(e),t)}function bt(e){const t=rt(e),n=t.indexOf("<body>"),s=t.lastIndexOf("</body>");return n<0||s<0?t:t.slice(n+6,s)}function st(e){return bt(e).replace(/<div class="tear"><\/div>\s*$/,"")}function Tt(e,t){const n=e.map(o=>st({...o.data,copyLabel:o.copyLabel??o.data.copyLabel})).join('<div class="tear"></div>'),s=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipts</title><style>${_}
  @page { size: A4; margin: 1cm; }
  .wrap { page-break-inside: avoid; }
</style></head>
<body>${n}<div class="tear"></div></body></html>`;J(s,t)}function J(e,t){const n=new Blob(["\uFEFF",e],{type:"application/msword"}),s=URL.createObjectURL(n),o=document.createElement("a");o.href=s,o.download=t,o.click(),URL.revokeObjectURL(s)}function Dt(e){const t=window.open("","_blank","width=860,height=900");t&&(t.document.write(it(e).replace(/^<html[^>]*>/,"<html>").replace(/<meta[^>]*>/,"")),t.document.close(),t.focus(),setTimeout(()=>t.print(),300))}function Rt(e){mt([e])}function mt(e){const n=`<html><head><title>Receipts</title><style>
  body { font-family: Arial, Helvetica, sans-serif; color:#0f172a; margin:0; background:#fff; }
  .wrap { border:1.2pt solid #312e81; border-radius:6px; margin:0 auto; max-width:700px; overflow:hidden; background:#fff; page-break-inside:avoid; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .hdr { text-align:center; padding:16px 12px 14px; background:#312e81; }
  .hdr h1 { font-size:15pt; margin:0; font-weight:bold; color:#fff; letter-spacing:0.4pt; }
  .hdr p { font-size:8.5pt; margin:3px 0 0; color:#c7d2fe; }
  .goldrule { height:3px; background:#b45309; }
  .titlebar { text-align:center; font-weight:bold; font-size:11pt; background:#eef2ff; color:#312e81; padding:7px; letter-spacing:4px; }
  .copytag { text-align:right; font-size:8pt; margin:4px 12px 0; color:#64748b; letter-spacing:1px; }
  .meta { width:100%; font-size:10pt; border-collapse:collapse; background:#f8fafc; border-bottom:1px solid #e2e8f0; }
  .meta td { padding:5px 8px; }
  .receipt-body { padding:18px 16px; font-size:10.5pt; line-height:1.9; }
  .wordband { background:#eef2ff; color:#312e81; font-style:italic; font-size:9.5pt; padding:5px 10px; margin:8px 0; }
  .amtbox { background:#eef2ff; border:1pt solid #312e81; color:#312e81; display:inline-block; padding:7px 16px; font-weight:bold; margin-top:14px; }
  table.sign { width:100%; }
  .cutline { border-top:2px dashed #94a3b8; margin:8px auto; max-width:700px; }
  @media print {
    body { margin: 10mm 12mm; }
    .cutline { margin: 6mm auto; }
  }
  </style></head><body>${e.map(o=>st(o)).join('<div class="cutline"></div>')}</body></html>`,s=window.open("","_blank","width=860,height=700");s&&(s.document.write(n),s.document.close(),s.focus(),setTimeout(()=>s.print(),300))}const gt={member_receipt:"Receipt Voucher",other_receipt:"Receipt Voucher",payment:"Payment Voucher",journal:"Journal Voucher"};function Ct(e){return gt[e]??"Voucher"}function ut(e){const t=["Code","Ledger / Particulars","Debit","Credit"],n=e.lines.map(i=>[i.code??"",[i.name.toUpperCase(),i.note?`    ${i.note}`:""].filter(Boolean).join(`
`),u(i.debit),u(i.credit)]),s=e.lines.reduce((i,p)=>i+p.debit,0),o=e.lines.reduce((i,p)=>i+p.credit,0);return n.push(["","TOTAL",u(s),u(o)]),{head:t,rows:n,totDr:s,totCr:o}}function xt(e){const t=new V({unit:"pt",format:"a4"}),n=t.internal.pageSize.getWidth(),s=t.internal.pageSize.getHeight(),o=38,i=n-o*2,p=30,b=s-130,y=o+i*.6,c=o+i-12;let l=Q(t,e.society,o,i,p)+22;x(t,W),t.rect(o,l,i,26,"F"),r(t,g),t.setFont("helvetica","bold"),t.setFontSize(11.5),t.text(e.title.toUpperCase(),o+i/2,l+17.5,{align:"center"}),r(t,h),l+=44;const S=e.title.startsWith("Payment")?"Paid to":e.title.startsWith("Receipt")?"Received from":"Party",L=[];e.party&&L.push(`${S}: ${e.party.toUpperCase()}`);const X=[e.chequeNo?`Cheque No.~ ${e.chequeNo}`:"",e.chequeDate?`dt ${D(e.chequeDate)}`:"",e.bankName??""].filter(Boolean);X.length&&L.push(X.join("   ·   ")),e.mode&&L.push(`Mode: ${e.mode}`);const d=38+L.length*15;x(t,M),$(t,z),t.setLineWidth(.6),t.rect(o,l,i,d,"FD"),t.setFont("helvetica","normal"),t.setFontSize(9.5),r(t,f),t.text("Voucher No.:",o+12,l+20),r(t,h),t.setFont("helvetica","bold"),t.text(e.voucherNo,o+88,l+20),t.setFont("helvetica","normal"),r(t,f),t.text("Voucher Date:",y,l+20),r(t,h),t.text(D(e.voucherDate),c,l+20,{align:"right"});let P=l+38;for(const v of L)t.setFontSize(9),r(t,f),t.text(v,o+12,P,{maxWidth:i-24}),P+=15;r(t,h),l+=d+18;const{head:R,rows:A}=ut(e),B=o+12,C=o+74,N=o+i-190,U=o+i-12;x(t,g),t.rect(o,l,i,22,"F"),r(t,q),t.setFont("helvetica","bold"),t.setFontSize(10),t.text(R[0],B,l+15),t.text(R[1],C,l+15),t.text(R[2],N,l+15,{align:"right"}),t.text(R[3],U,l+15,{align:"right"}),r(t,h),l+=22;const G=l;let H=0;for(const v of A){const k=String(v[1])==="TOTAL",F=String(v[1]).split(`
`),T=F[1]?26:17;k?(x(t,W),t.rect(o,l,i,T,"F")):H%2===1&&(x(t,M),t.rect(o,l,i,T,"F")),t.setFont("helvetica","normal"),t.setFontSize(9.5),r(t,k?g:h),t.text(String(v[0]??""),B,l+12),t.setFont("helvetica",k?"bold":"normal"),t.text(F[0]??"",C,l+12,{maxWidth:N-C-56}),F[1]&&(t.setFont("helvetica","normal"),t.setFontSize(8.4),r(t,f),t.text(F[1].trim(),C+10,l+23,{maxWidth:N-C-66}),t.setFontSize(9.5)),t.setFont("helvetica",k?"bold":"normal"),r(t,k?g:h),t.text(String(v[2]??""),N,l+12,{align:"right"}),t.text(String(v[3]??""),U,l+12,{align:"right"}),l+=T,H++}const O=l;r(t,h),t.setFont("helvetica","normal"),$(t,z),t.setLineWidth(.5),t.line(N-48,G,N-48,O),t.line(o,O,o+i,O),l=O+8,x(t,W),t.rect(o,l,i,22,"F"),r(t,g),t.setFont("helvetica","italic"),t.setFontSize(9.5),t.text(I(e.amount),o+12,l+15,{maxWidth:i-24}),r(t,h),l+=36,e.narration&&(t.setFont("helvetica","normal"),t.setFontSize(9),r(t,f),t.text("Narration:",o+12,l),r(t,h),t.text(e.narration,o+76,l,{maxWidth:i-96}));const w=b-68;return t.setFont("helvetica","bold"),t.setFontSize(9),r(t,g),t.text(`For ${e.society.name}`,o+i-12,w,{align:"right"}),$(t,z),t.setLineWidth(.6),t.setLineDashPattern([2,2],0),t.line(o+12,w+36,o+i*.32,w+36),t.line(o+i*.58,w+36,o+i-12,w+36),t.setLineDashPattern([],0),t.setFont("helvetica","normal"),t.setFontSize(8),r(t,f),t.text("Receiver's signature",o+12,w+48),t.text("Authorised signatory",o+i*.58,w+48),$(t,g),t.setLineWidth(1),t.rect(o,p,i,b-p),new Uint8Array(t.output("arraybuffer"))}function kt(e,t){Y(xt(e),t,"application/pdf")}function lt(e){const t=e.title.startsWith("Payment")?"Paid to":e.title.startsWith("Receipt")?"Received from":"Party";return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${a(e.title)} ${a(e.voucherNo)}</title><style>${_}
  .vhead { width:100%; font-size:10pt; border-collapse:collapse; background:#f8fafc; border-bottom:1px solid #e2e8f0; }
  .vhead td { padding:6px 10px; }
  .vhead .lbl { color:#64748b; }
  .vtable { width:100%; border-collapse:collapse; margin-top:0; }
  .vtable th { background:#312e81; color:#ffffff; font-size:10pt; padding:7px 10px; text-align:left; border:0; }
  .vtable th.r { text-align:right; }
  .vtable td { font-size:10pt; padding:5px 10px; border-bottom:1px solid #eef2ff; }
  .vtable tr:nth-child(even) td { background:#f8fafc; }
  .vtable td.num { text-align:right; }
  .vtable tr.total td { font-weight:bold; background:#eef2ff; color:#312e81; border-top:1px solid #cbd5e1; }
  .words { font-size:9.5pt; font-style:italic; color:#312e81; background:#eef2ff; padding:9px 12px; }
  .vsig { width:100%; padding:10px; border-collapse:collapse; }
  .vsig td { font-size:9pt; padding-top:36px; color:#64748b; }
  .sigline { border-top:1px dotted #94a3b8; margin:0 30px; }
</style></head>
<body><div class="wrap">
  ${Z(e.society)}
  <div class="titlebar" style="letter-spacing:3px;">${a(e.title.toUpperCase())}</div>
  <table class="vhead">
    <tr><td class="lbl">Voucher No.:</td><td><b>${a(e.voucherNo)}</b></td><td class="lbl" style="text-align:right">Voucher Date:</td><td style="text-align:right">${D(e.voucherDate)}</td></tr>
    ${e.party?`<tr><td colspan="4" class="lbl">${a(t)}: <b style="color:#0f172a">${a(e.party.toUpperCase())}</b></td></tr>`:""}
    ${e.chequeNo?`<tr><td colspan="4" class="lbl">Cheque No.~ <b style="color:#0f172a">${a(e.chequeNo)}</b>${e.chequeDate?` dt ${D(e.chequeDate)}`:""}${e.bankName?` · ${a(e.bankName)}`:""}</td></tr>`:""}
  </table>
  <table class="vtable">
    <thead><tr><th>Code</th><th>Ledger / Particulars</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead>
    <tbody>
      ${e.lines.map(n=>`<tr><td>${a(n.code??"")}</td><td>${a(n.name.toUpperCase())}${n.note?`<br><span style="font-size:8.5pt;color:#64748b">&nbsp;&nbsp;&nbsp;${a(n.note)}</span>`:""}</td><td class="num">${u(n.debit)}</td><td class="num">${u(n.credit)}</td></tr>`).join("")}
      <tr class="total"><td></td><td>TOTAL</td><td class="num">${u(e.lines.reduce((n,s)=>n+s.debit,0))}</td><td class="num">${u(e.lines.reduce((n,s)=>n+s.credit,0))}</td></tr>
    </tbody>
  </table>
  <div class="words">${a(I(e.amount))}</div>
  ${e.narration?`<div style="font-size:9.5pt;color:#64748b;padding:8px 12px">Narration: ${a(e.narration)}</div>`:""}
  <table class="vsig">
    <tr>
      <td style="width:50%"><div class="sigline"></div><div style="margin-top:4px">Receiver's signature</div></td>
      <td style="width:50%; text-align:right"><b style="color:#312e81">For ${a(e.society.name)}</b><div class="sigline"></div><div style="margin-top:4px">Authorised signatory</div></td>
    </tr>
  </table>
</div><div class="tear"></div></body></html>`}function Wt(e,t){J(lt(e),t)}function Et(e){const t=window.open("","_blank","width=860,height=800");t&&(t.document.write(lt(e).replace(/^<html[^>]*>/,"<html>").replace(/<meta[^>]*>/,"")),t.document.close(),t.focus(),setTimeout(()=>t.print(),300))}export{zt as a,$t as b,St as c,ht as d,pt as e,Dt as f,wt as g,Nt as h,Lt as i,Tt as j,mt as k,dt as l,xt as m,kt as n,Wt as o,Ft as p,Et as q,Rt as r,Ct as v};
