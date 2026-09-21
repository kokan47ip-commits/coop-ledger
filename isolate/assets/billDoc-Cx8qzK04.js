import{E as D}from"./jspdf.es.min-oHFq-V2Q.js";import{f as F}from"./format-XM8GajLH.js";const S=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"],U=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];function w(e){if(e<20)return S[e];const i=Math.floor(e/10),t=e%10;return U[i]+(t?` ${S[t]}`:"")}function T(e){const i=Math.floor(e/100),t=e%100,a=[];return i&&a.push(`${S[i]} Hundred`),t&&a.push(w(t)),a.join(" ")}function M(e){const i=Math.floor(Math.abs(e)),t=Math.round((Math.abs(e)-i)*100);if(i===0&&t===0)return"Zero";const a=Math.floor(i/1e7),r=Math.floor(i%1e7/1e5),o=Math.floor(i%1e5/1e3),l=i%1e3,s=[];a&&s.push(`${T(a)} Crore`),r&&s.push(`${w(r)} Lakh`),o&&s.push(`${w(o)} Thousand`),l&&s.push(T(l));let n=s.join(" ");return t>0&&(n+=`${n?" and":""} Paise ${w(t)}`),n}function v(e){return`Rupees : ${M(e)} Only`}const R=["PLEASE PAY BY CROSSED A/C. PAYEE CHEQUE ONLY.","THIS BILL IS PAYABLE ON OR BEFORE LAST DAY OF THE MONTH","LATEFEES @18% WILL BE CHARGED ON OVERDUE MONTH"];function h(e){return new Intl.NumberFormat("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}).format(e)}function j(e){const i=["January","February","March","April","May","June","July","August","September","October","November","December"],[t,a]=e.split("-");return`${i[Number(a)-1]??a},${t}`}function H(e){return[e.name,e.registrationNo??"",e.address??""].filter(Boolean)}function z(e,i,t){const a=e.internal.pageSize.getWidth(),r=H(i);e.setFont("helvetica","bold"),e.setFontSize(13),e.text(r[0],a/2,t,{align:"center"}),e.setFont("helvetica","normal"),e.setFontSize(9);let o=t+14;for(const l of r.slice(1))e.text(l,a/2,o,{align:"center"}),o+=12;return o}function Y(e,i){const t=new D({unit:"pt",format:"a4"}),a=t.internal.pageSize.getWidth(),r=t.internal.pageSize.getHeight(),o=40,l=a-o*2,s=44;let n=z(t,e.society,s+20);n+=6,t.setFont("helvetica","bold"),t.setFontSize(10),t.text(`Bill for the Month of ${e.periodLabel}`,a/2,n,{align:"center"}),n+=14,t.setDrawColor(60),t.setLineWidth(.8),t.line(o,n,o+l,n),n+=16;const u=o+l*.62,p=x=>x;t.setFontSize(10),t.setFont("helvetica","normal"),t.text("Bill No:",o+6,n),t.setFont("helvetica","bold"),t.text(p(String(e.billNo)),o+70,n),t.setFont("helvetica","normal"),t.text("Bill Date:",u,n),t.text(F(e.billDate),u+60,n),n+=16,t.text("Name:",o+6,n),t.setFont("helvetica","bold"),t.text(e.memberName.toUpperCase(),o+70,n),e.memberName2&&(n+=14,t.setFont("helvetica","normal"),t.text(e.memberName2.toUpperCase(),o+70,n)),t.setFont("helvetica","normal"),t.text("Area :",u,n-(e.memberName2?14:0)),e.area&&t.text(e.area,u+60,n-(e.memberName2?14:0)),n+=16,t.text("Flat",o+6,n),t.text(e.flatNo??"",o+70,n),t.text("Due Date:",u,n),t.text(F(e.dueDate),u+60,n),n+=8;const $=n,b=o+l-120;t.line(o,n,o+l,n),n+=14,t.setFont("helvetica","bold"),t.setFontSize(10.5),t.text("P A R T I C U L A R S",o+8,n),t.text("A M O U N T",o+l-8,n,{align:"right"}),t.line(o,n+5,o+l,n+5),t.line(b,$,b,r-240),n+=20,t.setFont("helvetica","normal"),t.setFontSize(10),e.lines.forEach((x,W)=>{t.text(`${W+1}. ${x.name.toUpperCase()}`,o+14,n),t.text(h(x.amount),o+l-10,n,{align:"right"}),n+=15});const m=r-240,g=o+l*.42,y=o+l-10;t.line(o,m,o+l,m),t.line(g,m,g,m+96);let f=m+18;t.text(v(e.totalDue),o+8,f,{align:"left",maxWidth:g-o-20}),t.text("Total:",g+110,f,{align:"right"}),t.text(h(e.total),y,f,{align:"right"}),f+=18,t.text("Arrears",g+110,f,{align:"right"}),t.text(h(e.arrears),y,f,{align:"right"}),f+=22,t.setFont("helvetica","bold"),t.text("Total Due:",g+110,f,{align:"right"}),t.text(h(e.totalDue),y,f,{align:"right"}),t.setFont("helvetica","normal");const d=m+96;t.line(o,d,o+l,d);const N=o+l*.5;t.line(N,d,N,d+92),t.line(o,d+92,o+l,d+92),t.line(o,s,o,d+92),t.line(o+l,s,o+l,d+92),t.line(o,s,o+l,s),t.setFontSize(8);let E=d+16;for(const x of R)t.text(x,o+6,E),E+=12;t.setFont("helvetica","bold"),t.setFontSize(9),t.text(`For ${e.society.name}`,o+l-8,d+16,{align:"right"}),t.setFont("helvetica","normal"),t.setFontSize(8),t.text("SECRETARY",o+l-8,d+78,{align:"right"}),t.setDrawColor(120),t.setLineDashPattern([6,4],0),t.line(o,d+120,o+l,d+120),t.setLineDashPattern([],0),t.save(i)}function k(e,i){const t=new D({unit:"pt",format:"a4"}),a=t.internal.pageSize.getWidth();t.internal.pageSize.getHeight();const r=40,o=a-r*2,l=60;z(t,e.society,l+22);let s=l+78;t.setDrawColor(60),t.setLineWidth(.8),t.line(r,s,r+o,s),s+=26,t.setFont("helvetica","bold"),t.setFontSize(13),t.text("R E C E I P T",a/2,s,{align:"center"}),t.setLineWidth(.6);const n=t.getTextWidth("R E C E I P T");t.line(a/2-n/2,s+4,a/2+n/2,s+4),s+=30,t.setFont("helvetica","normal"),t.setFontSize(10.5),t.text("Receipt No.:",r+8,s),t.text(String(e.receiptNo),r+90,s),t.text("Receipt Date:",a-190,s),t.text(F(e.receiptDate),a-100,s,{align:"right"}),s+=22,t.line(r,s,r+o,s),s+=26;const u=[{pre:"Received with thanks from ",bold:e.memberName.toUpperCase()},{pre:"the sum of ",bold:`Rs. ${h(e.amount)}/-`,post:" in words ",underline:!0}];let p=s;for(const b of u){t.setFont("helvetica","normal"),b.pre&&t.text(b.pre,r+12,p);const m=b.pre?t.getTextWidth(b.pre):0;if(t.setFont("helvetica","bold"),t.text(b.bold??"",r+12+m,p),b.underline){const g=t.getTextWidth(b.bold??"");t.setLineWidth(.5),t.line(r+12+m,p+2.5,r+12+m+g,p+2.5),t.setFont("helvetica","normal"),t.setFontSize(9),t.text(v(e.amount),r+12+m+g+24,p),t.setFontSize(10.5)}p+=20}t.setFont("helvetica","normal"),t.text(`in Part/Full Payment of ${e.purpose}`,r+12,p),p+=20;const $=[e.reference,e.mode].filter(Boolean).join(" · ");t.text(`being the charges for the Flat ${e.flatNo??"—"}${$?`   Cheque No.~ ${$}`:""}`,r+12,p),p+=34,t.setLineWidth(.8),t.rect(r+12,p,170,30),t.setFont("helvetica","bold"),t.setFontSize(11),t.text(`Rs. ${h(e.amount)} /-`,r+22,p+19),t.setFont("helvetica","normal"),t.setFontSize(7.5),t.text("*Subject to realisation of cheque(s).",r+12,p+42),t.setFont("helvetica","bold"),t.setFontSize(9),t.text(`For ${e.society.name}`,r+o-8,p+6,{align:"right"}),t.setFont("helvetica","normal"),t.setFontSize(8),t.text("SECRETARY",r+o-8,p+62,{align:"right"}),t.setLineWidth(.8),t.rect(r,l,o,p+70-l),t.setDrawColor(120),t.setLineDashPattern([6,4],0),t.line(r,p+100,r+o,p+100),t.setLineDashPattern([],0),t.save(i)}const C=`
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
`;function L(e){return`<div class="hdr">
    <h1>${c(e.name.toUpperCase())}</h1>
    ${e.registrationNo?`<p>${c(e.registrationNo)}</p>`:""}
    ${e.address?`<p>${c(e.address)}</p>`:""}
  </div>`}function c(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function A(e){return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Bill ${c(String(e.billNo))}</title><style>${C}</style></head>
<body><div class="wrap">
  ${L(e.society)}
  <div class="titlebar">Bill for the Month of ${c(e.periodLabel)}</div>
  <table class="meta">
    <tr><td>Bill No:</td><td><b>${c(String(e.billNo))}</b></td><td style="text-align:right">Bill Date:</td><td>${F(e.billDate)}</td></tr>
    <tr><td>Name:</td><td><b>${c(e.memberName.toUpperCase())}</b>${e.memberName2?`<br>${c(e.memberName2.toUpperCase())}`:""}</td><td style="text-align:right">Area :</td><td>${c(e.area??"")}</td></tr>
    <tr><td>Flat</td><td>${c(e.flatNo??"")}</td><td style="text-align:right">Due Date:</td><td>${F(e.dueDate)}</td></tr>
  </table>
  <table class="parthead"><tr><th>PARTICULARS</th><th class="r">AMOUNT</th></tr></table>
  <table class="lines">
    ${e.lines.map((i,t)=>`<tr><td>${t+1}.&nbsp; ${c(i.name.toUpperCase())}</td><td class="num">${h(i.amount)}</td></tr>`).join("")}
    ${Array.from({length:Math.max(0,6-e.lines.length)},()=>"<tr><td>&nbsp;</td><td></td></tr>").join("")}
  </table>
  <table class="tot">
    <tr><td rowspan="2" style="width:55%">${c(v(e.totalDue))}</td><td class="lbl">Total:</td><td class="val">${h(e.total)}</td></tr>
    <tr><td class="lbl">Arrears</td><td class="val">${h(e.arrears)}</td></tr>
    <tr><td></td><td class="lbl grand">Total Due:</td><td class="val grand">${h(e.totalDue)}</td></tr>
  </table>
  <table class="foot">
    <tr><td style="width:50%">${R.map(c).join("<br>")}</td>
    <td class="sig">For ${c(e.society.name)}<br><br><br><span style="font-weight:normal">SECRETARY</span></td></tr>
  </table>
</div><div class="tear"></div></body></html>`}function q(e,i){O(A(e),i)}function P(e){return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipt ${c(String(e.receiptNo))}</title><style>${C}</style></head>
<body><div class="wrap">
  ${L(e.society)}
  <div class="titlebar" style="text-decoration:underline; letter-spacing:3px;">RECEIPT</div>
  <table class="meta">
    <tr><td>Receipt No.:</td><td>${c(String(e.receiptNo))}</td><td style="text-align:right">Receipt Date:</td><td>${F(e.receiptDate)}</td></tr>
  </table>
  <div class="receipt-body">
    Received with thanks from <b>${c(e.memberName.toUpperCase())}</b><br>
    the sum of <b>Rs. ${h(e.amount)}/-</b> in words <b><u>${c(v(e.amount))}</u></b><br>
    in Part/Full Payment of ${c(e.purpose)}<br>
    being the charges for the Flat ${c(e.flatNo??"—")}${e.reference?` &nbsp;<b>Cheque No.~ ${c(e.reference)}</b>`:""}
    <table class="sign"><tr>
      <td><span class="amtbox">Rs. ${h(e.amount)} /-</span><br><span style="font-size:7.5pt">*Subject to realisation of cheque(s).</span></td>
      <td style="text-align:right; vertical-align:top"><b>For ${c(e.society.name)}</b><br><br><br><span style="font-weight:normal">SECRETARY</span></td>
    </tr></table>
  </div>
</div><div class="tear"></div></body></html>`}function X(e,i){O(P(e),i)}function O(e,i){const t=new Blob(["\uFEFF",e],{type:"application/msword"}),a=URL.createObjectURL(t),r=document.createElement("a");r.href=a,r.download=i,r.click(),URL.revokeObjectURL(a)}function J(e){const i=window.open("","_blank","width=860,height=900");i&&(i.document.write(A(e).replace(/^<html[^>]*>/,"<html>").replace(/<meta[^>]*>/,"")),i.document.close(),i.focus(),setTimeout(()=>i.print(),300))}function _(e){const i=window.open("","_blank","width=860,height=700");i&&(i.document.write(P(e).replace(/^<html[^>]*>/,"<html>").replace(/<meta[^>]*>/,"")),i.document.close(),i.focus(),setTimeout(()=>i.print(),300))}export{q as a,Y as b,M as c,J as d,k as e,X as f,j as p,_ as r};
