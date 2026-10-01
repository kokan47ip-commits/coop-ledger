import{E as V}from"./jspdf.es.min-DDf3EvoE.js";import{f as R}from"./format-V6CGZsZt.js";import{a as ot,q as ht,c as dt}from"./upiQr-DVXpr05j.js";const K=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"],ft=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];function Y(e){if(e<20)return K[e];const t=Math.floor(e/10),n=e%10;return ft[t]+(n?` ${K[n]}`:"")}function et(e){const t=Math.floor(e/100),n=e%100,s=[];return t&&s.push(`${K[t]} Hundred`),n&&s.push(Y(n)),s.join(" ")}function bt(e){const t=Math.floor(Math.abs(e)),n=Math.round((Math.abs(e)-t)*100);if(t===0&&n===0)return"Zero";const s=Math.floor(t/1e7),o=Math.floor(t%1e7/1e5),i=Math.floor(t%1e5/1e3),p=t%1e3,d=[];s&&d.push(`${et(s)} Crore`),o&&d.push(`${Y(o)} Lakh`),i&&d.push(`${Y(i)} Thousand`),p&&d.push(et(p));let f=d.join(" ");return n>0&&(f+=`${f?" and":""} Paise ${Y(n)}`),f}function q(e){return`Rupees : ${bt(e)} Only`}const nt=["PLEASE PAY BY CROSSED A/C. PAYEE CHEQUE ONLY.","THIS BILL IS PAYABLE ON OR BEFORE LAST DAY OF THE MONTH","LATEFEES @18% WILL BE CHARGED ON OVERDUE MONTH"];function g(e){return new Intl.NumberFormat("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}).format(e)}function Nt(e){const t=["January","February","March","April","May","June","July","August","September","October","November","December"],[n,s]=e.split("-");return`${t[Number(s)-1]??s},${n}`}const h=[15,23,42],m=[100,116,139],x=[49,46,129],E=[238,242,255],I=[248,250,252],it=[180,83,9],N=[203,213,225],j=[255,255,255];function y(e,t){e.setFillColor(t[0],t[1],t[2])}function $(e,t){e.setDrawColor(t[0],t[1],t[2])}function r(e,t){e.setTextColor(t[0],t[1],t[2])}function Z(e,t,n,s,o){y(e,x),e.rect(n,o,s,76,"F"),y(e,it),e.rect(n,o+76,s,3,"F");const p=n+s/2;r(e,j),e.setFont("helvetica","bold"),e.setFontSize(15),e.text(t.name.toUpperCase(),p,o+31,{align:"center",maxWidth:s-36}),r(e,[199,210,254]),e.setFont("helvetica","normal"),e.setFontSize(8.6);let d=o+47;for(const f of[t.registrationNo,t.address].filter(Boolean))e.text(f,p,d,{align:"center",maxWidth:s-44}),d+=11;return r(e,h),o+76+3}function mt(e,t,n,s,o){const i=ht(t),p=i.length,d=o/p;y(e,j),e.rect(n,s,o,o,"F"),y(e,h);for(let f=0;f<p;f++)for(let a=0;a<p;a++)i[f][a]&&e.rect(n+a*d,s+f*d,d+.2,d+.2,"F")}function Tt(e,t){_(gt(e),t,"application/pdf")}function _(e,t,n){const s=new Blob([e],{type:n}),o=URL.createObjectURL(s),i=document.createElement("a");i.href=o,i.download=t,document.body.appendChild(i),i.click(),i.remove(),URL.revokeObjectURL(o)}function gt(e){const t=new V({unit:"pt",format:"a4"}),n=t.internal.pageSize.getWidth(),s=t.internal.pageSize.getHeight(),o=38,i=n-o*2,p=30,d=68,f=84,a=s-138,u=a-d,l=u-f,L=o+i*.56,w=o+i-12;let b=Z(t,e.society,o,i,p)+22;y(t,E),t.rect(o,b,i,26,"F"),r(t,x),t.setFont("helvetica","bold"),t.setFontSize(11.5),t.text(`BILL FOR THE MONTH OF ${e.periodLabel.toUpperCase()}`,o+i/2,b+17.5,{align:"center"}),r(t,h),b+=44;const A=o+i*.6,k=b+20,U=k+24,B=U+(e.memberName2?15:0)+24,W=B-b+18;y(t,I),$(t,N),t.setLineWidth(.6),t.rect(o,b,i,W,"FD");const T=(F,C,D,pt=!1)=>{t.setFont("helvetica","normal"),t.setFontSize(9.5),r(t,m),t.text(F,o+12,D),t.setFont("helvetica",pt?"bold":"normal"),r(t,h),t.text(C,o+66,D,{maxWidth:A-o-78})},O=(F,C,D)=>{t.setFont("helvetica","normal"),t.setFontSize(9.5),r(t,m),t.text(F,A,D),r(t,h),t.text(C,w,D,{align:"right"})};T("Bill No:",String(e.billNo),k,!0),O("Bill Date:",R(e.billDate),k),T("Name:",e.memberName.toUpperCase(),U,!0),e.memberName2&&(t.setFont("helvetica","normal"),r(t,h),t.text(e.memberName2.toUpperCase(),o+66,U+14,{maxWidth:A-o-78})),O("Area :",e.area??"—",U),T("Flat",e.flatNo??"—",B),O("Due Date:",R(e.dueDate),B),b+=W+18,y(t,x),t.rect(o,b,i,22,"F"),r(t,j),t.setFont("helvetica","bold"),t.setFontSize(10),t.text("P A R T I C U L A R S",o+12,b+15),t.text("A M O U N T",o+i-12,b+15,{align:"right"}),r(t,h),b+=22;const G=b,H=o+i-122,M=Math.max(e.lines.length,1),S=Math.max(12,Math.min(17,Math.floor((l-b)/M)));t.setFont("helvetica","normal"),t.setFontSize(10),e.lines.forEach((F,C)=>{C%2===1&&(y(t,I),t.rect(o,b,i,S,"F"));const D=F.serial??String(C+1);r(t,h),t.text(`${D}. ${F.name.toUpperCase()}`,o+12,b+S-5,{maxWidth:H-o-24}),t.text(g(F.amount),o+i-12,b+S-5,{align:"right"}),b+=S});for(let F=e.lines.length;b+S<=l;F++)F%2===1&&(y(t,I),t.rect(o,b,i,S,"F")),b+=S;$(t,E),t.setLineWidth(.6),t.line(H,G,H,l),$(t,N),t.line(o,l,o+i,l);let v=l+17;t.setFont("helvetica","italic"),t.setFontSize(8.6),r(t,m),t.text(q(e.totalDue),o+12,v,{maxWidth:L-o-30}),t.setFont("helvetica","normal"),t.setFontSize(10),t.text("Total:",L,v,{align:"right"}),r(t,h),t.text(g(e.total),w,v,{align:"right"}),v+=17,r(t,m),t.text("Arrears:",L,v,{align:"right"}),r(t,h),t.text(g(e.arrears),w,v,{align:"right"}),v+=21,y(t,x),t.rect(L-16,v-15,w-L+28,23,"F"),r(t,j),t.setFont("helvetica","bold"),t.setFontSize(10.5),t.text("Total Due:",L,v+1.5,{align:"right"}),t.text(g(e.totalDue),w,v+1.5,{align:"right"}),r(t,h),t.setFont("helvetica","normal"),y(t,I),t.rect(o,u,i,d,"F"),$(t,N),t.setLineWidth(.6),t.line(o,u,o+i,u),t.line(o+i*.52,u,o+i*.52,a),t.setFont("helvetica","normal"),t.setFontSize(7.6),r(t,m);const z=e.upi;if(z){const C=o+10,D=u+8;mt(t,ot(z.uri,z.amount),C,D,46),t.setFont("helvetica","bold"),t.setFontSize(5.4),r(t,x),t.text(`SCAN TO PAY RS ${g(z.amount)}`,C+46/2,D+46+7.5,{align:"center"}),r(t,m),t.setFont("helvetica","normal"),t.setFontSize(7.6)}let P=u+19;for(const F of nt)t.text(F,o+(z?70:12),P),P+=12;return t.setFont("helvetica","bold"),t.setFontSize(9),r(t,x),t.text(`For ${e.society.name}`,o+i-12,u+19,{align:"right"}),$(t,N),t.setLineDashPattern([2,2],0),t.line(o+i*.62,u+42,o+i-12,u+42),t.setLineDashPattern([],0),t.setFont("helvetica","normal"),t.setFontSize(8),r(t,m),t.text("SECRETARY",o+i-12,u+54,{align:"right"}),$(t,x),t.setLineWidth(1),t.rect(o,p,i,a-p),$(t,N),t.setLineWidth(.8),t.setLineDashPattern([5,4],0),t.line(o,a+30,o+i,a+30),t.setLineDashPattern([],0),new Uint8Array(t.output("arraybuffer"))}function rt(e,t,n,s,o){const i=s;let p=Z(e,t.society,n,o,i)+20;t.copyLabel&&(e.setFont("helvetica","normal"),e.setFontSize(7.6),r(e,m),e.text(t.copyLabel.toUpperCase(),n+o-12,p,{align:"right"}),p+=14),e.setFont("helvetica","bold"),e.setFontSize(13.5),r(e,x);const d="R E C E I P T";e.text(d,n+o/2,p+10,{align:"center"});const f=e.getTextWidth(d);y(e,it),e.rect(n+o/2-f/2,p+15,f,2,"F"),r(e,h),p+=30,y(e,E),e.rect(n,p,o,22,"F"),e.setFont("helvetica","normal"),e.setFontSize(9.5),r(e,m),e.text("Receipt No.:",n+12,p+15),r(e,h),e.setFont("helvetica","bold"),e.text(String(t.receiptNo),n+84,p+15),e.setFont("helvetica","normal"),r(e,m),e.text("Receipt Date:",n+o-168,p+15),r(e,h),e.text(R(t.receiptDate),n+o-12,p+15,{align:"right"}),p+=46;let a=p;e.setFontSize(10.5),e.setFont("helvetica","normal"),r(e,m),e.text("Received with thanks from",n+16,a),e.setFont("helvetica","bold"),r(e,h),e.text(t.memberName.toUpperCase(),n+158,a,{maxWidth:n+o-20-(n+158)}),a+=20,e.setFont("helvetica","normal"),r(e,m),e.text("the sum of",n+16,a),e.setFont("helvetica","bold"),r(e,x),e.text(`Rs. ${g(t.amount)}/-`,n+78,a),e.setFont("helvetica","normal"),r(e,m),e.text("in words",n+180,a),a+=8,y(e,E),e.rect(n+16,a,o-32,20,"F"),e.setFont("helvetica","italic"),e.setFontSize(9.2),r(e,x),e.text(q(t.amount),n+24,a+13.5,{maxWidth:o-48}),a+=34,e.setFont("helvetica","normal"),e.setFontSize(10.5),r(e,m),e.text("in Part/Full Payment of",n+16,a),r(e,h),e.text(t.purpose,n+162,a,{maxWidth:n+o-20-(n+162)}),a+=20,r(e,m),e.text("being the charges for the Flat",n+16,a),r(e,h);const u=[t.reference,t.mode].filter(Boolean).join(" · ");e.text(`${t.flatNo??"—"}${u?`   Cheque No.~ ${u}`:""}`,n+176,a,{maxWidth:n+o-20-(n+176)}),a+=36;const l=178;y(e,E),$(e,x),e.setLineWidth(1),e.rect(n+16,a-14,l,30,"FD"),e.setFont("helvetica","bold"),e.setFontSize(11.5),r(e,x);const L=`Rs. ${g(t.amount)} /-`;e.text(L,n+16+(l-e.getTextWidth(L))/2,a+5),e.setFont("helvetica","normal"),e.setFontSize(7.4),r(e,m),e.text("*Subject to realisation of cheque(s).",n+16,a+28),e.setFont("helvetica","bold"),e.setFontSize(9),r(e,x),e.text(`For ${t.society.name}`,n+o-12,a,{align:"right"}),$(e,N),e.setLineWidth(.6),e.setLineDashPattern([2,2],0),e.line(n+o-168,a+34,n+o-12,a+34),e.setLineDashPattern([],0),e.setFont("helvetica","normal"),e.setFontSize(8),r(e,m),e.text("SECRETARY",n+o-12,a+46,{align:"right"});const w=a+66;return $(e,x),e.setLineWidth(1),e.rect(n,i,o,w-i),w}function ut(e){const t=new V({unit:"pt",format:"a4"}),n=t.internal.pageSize.getWidth(),s=38,o=n-s*2,i=rt(t,e,s,56,o);return $(t,N),t.setLineWidth(.8),t.setLineDashPattern([5,4],0),t.line(s,i+30,s+o,i+30),t.setLineDashPattern([],0),new Uint8Array(t.output("arraybuffer"))}function Dt(e,t){_(ut(e),t,"application/pdf")}function Rt(e,t,n=!1){_(xt(e,n),t,"application/pdf")}function xt(e,t=!1){const n=new V({unit:"pt",format:"a4"}),s=n.internal.pageSize.getWidth(),o=38,i=s-o*2,p=t?2:1,d=u=>t?u===0?44:424:56;let f=0,a=0;for(const u of e){if(f>=p&&(n.addPage(),f=0),t&&f===1){const l=Math.round((a+d(1))/2);$(n,N),n.setLineWidth(.8),n.setLineDashPattern([5,4],0),n.line(o,l,o+i,l),n.setLineDashPattern([],0)}a=rt(n,{...u.data,copyLabel:u.copyLabel??u.data.copyLabel},o,d(f),i),f++}return new Uint8Array(n.output("arraybuffer"))}function Ct(e){let t="";for(let s=0;s<e.length;s+=8192){let o="";for(let i=s;i<Math.min(s+8192,e.length);i++)o+=String.fromCharCode(e[i]??0);t+=o}return btoa(t)}const X=`
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
`;function tt(e){return`<div class="hdr">
    <h1>${c(e.name.toUpperCase())}</h1>
    ${e.registrationNo?`<p>${c(e.registrationNo)}</p>`:""}
    ${e.address?`<p>${c(e.address)}</p>`:""}
  </div><div class="goldrule"></div>`}function c(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function st(e){const t=e.upi,n=t?ot(t.uri,t.amount):null,s=n?dt(n):null;return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Bill ${c(String(e.billNo))}</title><style>${X}</style></head>
<body><div class="wrap">
  ${tt(e.society)}
  <div class="titlebar">BILL FOR THE MONTH OF ${c(e.periodLabel.toUpperCase())}</div>
  <table class="meta">
    <tr><td style="color:#64748b">Bill No:</td><td><b>${c(String(e.billNo))}</b></td><td style="text-align:right;color:#64748b">Bill Date:</td><td style="text-align:right">${R(e.billDate)}</td></tr>
    <tr><td style="color:#64748b">Name:</td><td><b>${c(e.memberName.toUpperCase())}</b>${e.memberName2?`<br>${c(e.memberName2.toUpperCase())}`:""}</td><td style="text-align:right;color:#64748b">Area :</td><td style="text-align:right">${c(e.area??"")}</td></tr>
    <tr><td style="color:#64748b">Flat</td><td>${c(e.flatNo??"")}</td><td style="text-align:right;color:#64748b">Due Date:</td><td style="text-align:right">${R(e.dueDate)}</td></tr>
  </table>
  <table class="parthead"><tr><th>P A R T I C U L A R S</th><th class="r">A M O U N T</th></tr></table>
  <table class="lines">
    ${e.lines.map((o,i)=>`<tr><td>${o.serial??i+1}.&nbsp; ${c(o.name.toUpperCase())}</td><td class="num">${g(o.amount)}</td></tr>`).join("")}
    ${Array.from({length:Math.max(0,7-e.lines.length)},()=>"<tr><td>&nbsp;</td><td></td></tr>").join("")}
  </table>
  <table class="tot">
    <tr><td class="words" rowspan="2" style="width:52%">${c(q(e.totalDue))}</td><td class="lbl">Total:</td><td class="val">${g(e.total)}</td></tr>
    <tr><td class="lbl">Arrears:</td><td class="val">${g(e.arrears)}</td></tr>
    <tr class="grand"><td></td><td class="lbl">Total Due:</td><td class="val">${g(e.totalDue)}</td></tr>
  </table>
  <table class="foot">
    <tr>
      ${s&&t?`<td style="width:66px;vertical-align:middle;text-align:center"><img src="${s}" style="width:60px;height:60px" alt="UPI QR"><br><span style="font-size:6.5pt;font-weight:bold;color:#312e81">SCAN TO PAY RS ${g(t.amount)}</span></td>`:""}
      <td style="width:50%">${nt.map(c).join("<br>")}</td>
    <td class="sig">For ${c(e.society.name)}<br><br><br><span class="sigspan">SECRETARY</span></td></tr>
  </table>
</div><div class="tear"></div></body></html>`}function kt(e,t){J(st(e),t)}function lt(e){return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipt ${c(String(e.receiptNo))}</title><style>${X}</style></head>
<body><div class="wrap">
  ${tt(e.society)}
  <div class="titlebar" style="letter-spacing:4px;">RECEIPT</div>
  ${e.copyLabel?`<p class="copytag">${c(e.copyLabel.toUpperCase())}</p>`:""}
  <table class="meta">
    <tr><td style="color:#64748b">Receipt No.:</td><td><b>${c(String(e.receiptNo))}</b></td><td style="text-align:right;color:#64748b">Receipt Date:</td><td style="text-align:right">${R(e.receiptDate)}</td></tr>
  </table>
  <div class="receipt-body">
    <span style="color:#64748b">Received with thanks from</span> <b>${c(e.memberName.toUpperCase())}</b><br>
    <span style="color:#64748b">the sum of</span> <b style="color:#312e81">Rs. ${g(e.amount)}/-</b> <span style="color:#64748b">in words</span>
    <div class="wordband">${c(q(e.amount))}</div>
    <span style="color:#64748b">in Part/Full Payment of</span> ${c(e.purpose)}<br>
    <span style="color:#64748b">being the charges for the Flat</span> ${c(e.flatNo??"—")}${e.reference?` &nbsp;<b>Cheque No.~ ${c(e.reference)}</b>`:""}
    <table class="sign"><tr>
      <td style="vertical-align:top"><span class="amtbox">Rs. ${g(e.amount)} /-</span><br><span style="font-size:7.5pt;color:#64748b">*Subject to realisation of cheque(s).</span></td>
      <td style="text-align:right; vertical-align:top"><b style="color:#312e81">For ${c(e.society.name)}</b><br><br><br><span style="font-weight:normal;color:#64748b">SECRETARY</span></td>
    </tr></table>
  </div>
</div><div class="tear"></div></body></html>`}function Wt(e,t){J(lt(e),t)}function yt(e){const t=lt(e),n=t.indexOf("<body>"),s=t.lastIndexOf("</body>");return n<0||s<0?t:t.slice(n+6,s)}function at(e){return yt(e).replace(/<div class="tear"><\/div>\s*$/,"")}function Et(e,t){const n=e.map(o=>at({...o.data,copyLabel:o.copyLabel??o.data.copyLabel})).join('<div class="tear"></div>'),s=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipts</title><style>${X}
  @page { size: A4; margin: 1cm; }
  .wrap { page-break-inside: avoid; }
</style></head>
<body>${n}<div class="tear"></div></body></html>`;J(s,t)}function J(e,t){const n=new Blob(["\uFEFF",e],{type:"application/msword"}),s=URL.createObjectURL(n),o=document.createElement("a");o.href=s,o.download=t,o.click(),URL.revokeObjectURL(s)}function Pt(e){const t=window.open("","_blank","width=860,height=900");t&&(t.document.write(st(e).replace(/^<html[^>]*>/,"<html>").replace(/<meta[^>]*>/,"")),t.document.close(),t.focus(),setTimeout(()=>t.print(),300))}function At(e){vt([e])}function vt(e){const n=`<html><head><title>Receipts</title><style>
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
  </style></head><body>${e.map(o=>at(o)).join('<div class="cutline"></div>')}</body></html>`,s=window.open("","_blank","width=860,height=700");s&&(s.document.write(n),s.document.close(),s.focus(),setTimeout(()=>s.print(),300))}const Ft={member_receipt:"Receipt Voucher",other_receipt:"Receipt Voucher",payment:"Payment Voucher",journal:"Journal Voucher"};function Ut(e){return Ft[e]??"Voucher"}function $t(e){const t=["Code","Ledger / Particulars","Debit","Credit"],n=e.lines.map(i=>[i.code??"",[i.name.toUpperCase(),i.note?`    ${i.note}`:""].filter(Boolean).join(`
`),g(i.debit),g(i.credit)]),s=e.lines.reduce((i,p)=>i+p.debit,0),o=e.lines.reduce((i,p)=>i+p.credit,0);return n.push(["","TOTAL",g(s),g(o)]),{head:t,rows:n,totDr:s,totCr:o}}function St(e){const t=new V({unit:"pt",format:"a4"}),n=t.internal.pageSize.getWidth(),s=t.internal.pageSize.getHeight(),o=38,i=n-o*2,p=30,d=s-130,f=o+i*.6,a=o+i-12;let l=Z(t,e.society,o,i,p)+22;y(t,E),t.rect(o,l,i,26,"F"),r(t,x),t.setFont("helvetica","bold"),t.setFontSize(11.5),t.text(e.title.toUpperCase(),o+i/2,l+17.5,{align:"center"}),r(t,h),l+=44;const L=e.title.startsWith("Payment")?"Paid to":e.title.startsWith("Receipt")?"Received from":"Party",w=[];e.party&&w.push(`${L}: ${e.party.toUpperCase()}`);const Q=[e.chequeNo?`Cheque No.~ ${e.chequeNo}`:"",e.chequeDate?`dt ${R(e.chequeDate)}`:"",e.bankName??""].filter(Boolean);Q.length&&w.push(Q.join("   ·   ")),e.mode&&w.push(`Mode: ${e.mode}`);const b=38+w.length*15;y(t,I),$(t,N),t.setLineWidth(.6),t.rect(o,l,i,b,"FD"),t.setFont("helvetica","normal"),t.setFontSize(9.5),r(t,m),t.text("Voucher No.:",o+12,l+20),r(t,h),t.setFont("helvetica","bold"),t.text(e.voucherNo,o+88,l+20),t.setFont("helvetica","normal"),r(t,m),t.text("Voucher Date:",f,l+20),r(t,h),t.text(R(e.voucherDate),a,l+20,{align:"right"});let A=l+38;for(const v of w)t.setFontSize(9),r(t,m),t.text(v,o+12,A,{maxWidth:i-24}),A+=15;r(t,h),l+=b+18;const{head:k,rows:U}=$t(e),B=o+12,W=o+74,T=o+i-190,O=o+i-12;y(t,x),t.rect(o,l,i,22,"F"),r(t,j),t.setFont("helvetica","bold"),t.setFontSize(10),t.text(k[0],B,l+15),t.text(k[1],W,l+15),t.text(k[2],T,l+15,{align:"right"}),t.text(k[3],O,l+15,{align:"right"}),r(t,h),l+=22;const G=l;let H=0;for(const v of U){const z=String(v[1])==="TOTAL",P=String(v[1]).split(`
`),F=P[1]?26:17;z?(y(t,E),t.rect(o,l,i,F,"F")):H%2===1&&(y(t,I),t.rect(o,l,i,F,"F")),t.setFont("helvetica","normal"),t.setFontSize(9.5),r(t,z?x:h),t.text(String(v[0]??""),B,l+12),t.setFont("helvetica",z?"bold":"normal"),t.text(P[0]??"",W,l+12,{maxWidth:T-W-56}),P[1]&&(t.setFont("helvetica","normal"),t.setFontSize(8.4),r(t,m),t.text(P[1].trim(),W+10,l+23,{maxWidth:T-W-66}),t.setFontSize(9.5)),t.setFont("helvetica",z?"bold":"normal"),r(t,z?x:h),t.text(String(v[2]??""),T,l+12,{align:"right"}),t.text(String(v[3]??""),O,l+12,{align:"right"}),l+=F,H++}const M=l;r(t,h),t.setFont("helvetica","normal"),$(t,N),t.setLineWidth(.5),t.line(T-48,G,T-48,M),t.line(o,M,o+i,M),l=M+8,y(t,E),t.rect(o,l,i,22,"F"),r(t,x),t.setFont("helvetica","italic"),t.setFontSize(9.5),t.text(q(e.amount),o+12,l+15,{maxWidth:i-24}),r(t,h),l+=36,e.narration&&(t.setFont("helvetica","normal"),t.setFontSize(9),r(t,m),t.text("Narration:",o+12,l),r(t,h),t.text(e.narration,o+76,l,{maxWidth:i-96}));const S=d-68;return t.setFont("helvetica","bold"),t.setFontSize(9),r(t,x),t.text(`For ${e.society.name}`,o+i-12,S,{align:"right"}),$(t,N),t.setLineWidth(.6),t.setLineDashPattern([2,2],0),t.line(o+12,S+36,o+i*.32,S+36),t.line(o+i*.58,S+36,o+i-12,S+36),t.setLineDashPattern([],0),t.setFont("helvetica","normal"),t.setFontSize(8),r(t,m),t.text("Receiver's signature",o+12,S+48),t.text("Authorised signatory",o+i*.58,S+48),$(t,x),t.setLineWidth(1),t.rect(o,p,i,d-p),new Uint8Array(t.output("arraybuffer"))}function Bt(e,t){_(St(e),t,"application/pdf")}function ct(e){const t=e.title.startsWith("Payment")?"Paid to":e.title.startsWith("Receipt")?"Received from":"Party";return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${c(e.title)} ${c(e.voucherNo)}</title><style>${X}
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
  ${tt(e.society)}
  <div class="titlebar" style="letter-spacing:3px;">${c(e.title.toUpperCase())}</div>
  <table class="vhead">
    <tr><td class="lbl">Voucher No.:</td><td><b>${c(e.voucherNo)}</b></td><td class="lbl" style="text-align:right">Voucher Date:</td><td style="text-align:right">${R(e.voucherDate)}</td></tr>
    ${e.party?`<tr><td colspan="4" class="lbl">${c(t)}: <b style="color:#0f172a">${c(e.party.toUpperCase())}</b></td></tr>`:""}
    ${e.chequeNo?`<tr><td colspan="4" class="lbl">Cheque No.~ <b style="color:#0f172a">${c(e.chequeNo)}</b>${e.chequeDate?` dt ${R(e.chequeDate)}`:""}${e.bankName?` · ${c(e.bankName)}`:""}</td></tr>`:""}
  </table>
  <table class="vtable">
    <thead><tr><th>Code</th><th>Ledger / Particulars</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead>
    <tbody>
      ${e.lines.map(n=>`<tr><td>${c(n.code??"")}</td><td>${c(n.name.toUpperCase())}${n.note?`<br><span style="font-size:8.5pt;color:#64748b">&nbsp;&nbsp;&nbsp;${c(n.note)}</span>`:""}</td><td class="num">${g(n.debit)}</td><td class="num">${g(n.credit)}</td></tr>`).join("")}
      <tr class="total"><td></td><td>TOTAL</td><td class="num">${g(e.lines.reduce((n,s)=>n+s.debit,0))}</td><td class="num">${g(e.lines.reduce((n,s)=>n+s.credit,0))}</td></tr>
    </tbody>
  </table>
  <div class="words">${c(q(e.amount))}</div>
  ${e.narration?`<div style="font-size:9.5pt;color:#64748b;padding:8px 12px">Narration: ${c(e.narration)}</div>`:""}
  <table class="vsig">
    <tr>
      <td style="width:50%"><div class="sigline"></div><div style="margin-top:4px">Receiver's signature</div></td>
      <td style="width:50%; text-align:right"><b style="color:#312e81">For ${c(e.society.name)}</b><div class="sigline"></div><div style="margin-top:4px">Authorised signatory</div></td>
    </tr>
  </table>
</div><div class="tear"></div></body></html>`}function Ot(e,t){J(ct(e),t)}function Ht(e){const t=window.open("","_blank","width=860,height=800");t&&(t.document.write(ct(e).replace(/^<html[^>]*>/,"<html>").replace(/<meta[^>]*>/,"")),t.document.close(),t.focus(),setTimeout(()=>t.print(),300))}export{kt as a,Tt as b,Ct as c,gt as d,bt as e,Pt as f,Dt as g,Wt as h,Rt as i,Et as j,vt as k,ut as l,St as m,Bt as n,Ot as o,Nt as p,Ht as q,At as r,Ut as v};
