import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';

const fmt  = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
const fmtC = n => '₹' + fmt(n);
const pct  = n => isFinite(n) && !isNaN(n) ? n.toFixed(2) + '%' : '—';

const StatusBadge = ({ s }) => {
  const map = { 'Fulfilled':{ background:'#052e16',color:'#34d399',border:'1px solid #14532d' },'In Transit':{ background:'#451a03',color:'#fb923c',border:'1px solid #7c2d12' },'Advance Pending':{ background:'#450a0a',color:'#f87171',border:'1px solid #7f1d1d' } };
  const s2 = map[s] || { background:'#1e293b',color:'#94a3b8',border:'1px solid #334155' };
  return <span style={{ ...s2, fontSize:11, padding:'2px 8px', borderRadius:6, fontFamily:"'DM Mono',monospace" }}>{s}</span>;
};

const AlertBox = ({ msg }) => (
  <div style={{ display:'flex',alignItems:'center',gap:8,background:'#450a0a',border:'1px solid #7f1d1d',color:'#f87171',borderRadius:8,padding:'10px 14px',fontSize:12,fontFamily:"'DM Mono',monospace" }}>
    <span style={{ fontSize:16 }}>⚠</span> {msg}
  </div>
);

const Spinner = () => <div style={{ textAlign:'center',padding:40,color:'#475569',fontFamily:"'DM Mono',monospace",fontSize:13 }}>Loading…</div>;

export default function DashboardPage() {
  const { user, signOut } = useAuth();
  const [view,setView]           = useState('dashboard');
  const [customers,setCustomers] = useState([]);
  const [pos,setPos]             = useState([]);
  const [cns,setCns]             = useState([]);
  const [settings,setSettings]   = useState({ default_purchase_price_exw:400000, default_purchase_price_ddp:403000 });
  const [loading,setLoading]     = useState(true);
  const [saving,setSaving]       = useState(false);
  const [toast,setToast]         = useState('');

  const [poForm,setPoForm]         = useState({ customer_id:'',delivery_type:'DDP',qty:'',unit_price:'',purchase_price:'',vendor_name:'Primary Manufacturer',vendor_invoice_no:'',purchase_date:'',advance:'',po_date:'',status:'Advance Pending' });
  const [cnForm,setCnForm]         = useState({ po_id:'',type:'CNNote',amount:'',foc_units:'',cn_date:'',note:'' });
  const [custForm,setCustForm]     = useState({ name:'',gstin:'' });
  const [sim,setSim]               = useState({ customerId:'',extraCN:'',extraFOC:'' });
  const [settingsForm,setSettingsForm] = useState({ exw:'',ddp:'' });

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3500); };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data:c },{ data:p },{ data:cn },{ data:s }] = await Promise.all([
      supabase.from('customers').select('*').order('id'),
      supabase.from('purchase_orders').select('*').order('created_at'),
      supabase.from('credit_notes').select('*').order('created_at'),
      supabase.from('settings').select('*'),
    ]);
    setCustomers(c||[]);
    setPos(p||[]);
    setCns(cn||[]);
    if (s) {
      const parsed={};
      s.forEach(r=>{ parsed[r.key]=Number(r.value); });
      setSettings(parsed);
      setSettingsForm({ exw:parsed.default_purchase_price_exw, ddp:parsed.default_purchase_price_ddp });
    }
    setLoading(false);
  }, []);

  useEffect(()=>{ fetchAll(); },[fetchAll]);

  // When delivery type changes, auto-fill the default purchase price
  const handleDeliveryChange = type => {
    const defaultPrice = type==='DDP' ? settings.default_purchase_price_ddp : settings.default_purchase_price_exw;
    setPoForm(f=>({ ...f, delivery_type:type, purchase_price: f.vendor_name==='Primary Manufacturer' ? defaultPrice : f.purchase_price }));
  };

  const addCustomer = async () => {
    if (!custForm.name) return;
    setSaving(true);
    const { error } = await supabase.from('customers').insert([custForm]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Customer added ✓'); setCustForm({ name:'',gstin:'' }); await fetchAll(); }
    setSaving(false);
  };

  const addPO = async () => {
    if (!poForm.customer_id||!poForm.qty||!poForm.unit_price||!poForm.purchase_price||!poForm.advance||!poForm.po_date) { showToast('Please fill all required fields'); return; }
    setSaving(true);
    const { data:idData } = await supabase.rpc('next_po_id');
    const { error } = await supabase.from('purchase_orders').insert([{
      id:idData, customer_id:Number(poForm.customer_id), delivery_type:poForm.delivery_type,
      qty:Number(poForm.qty), unit_price:Number(poForm.unit_price), purchase_price:Number(poForm.purchase_price),
      vendor_name:poForm.vendor_name||'Primary Manufacturer', vendor_invoice_no:poForm.vendor_invoice_no,
      purchase_date:poForm.purchase_date||null, advance:Number(poForm.advance), po_date:poForm.po_date, status:poForm.status,
    }]);
    if (error) showToast('Error: '+error.message);
    else {
      showToast('Purchase Order added ✓');
      const defPrice = poForm.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw;
      setPoForm({ customer_id:'',delivery_type:'DDP',qty:'',unit_price:'',purchase_price:settings.default_purchase_price_ddp,vendor_name:'Primary Manufacturer',vendor_invoice_no:'',purchase_date:'',advance:'',po_date:'',status:'Advance Pending' });
      await fetchAll();
    }
    setSaving(false);
  };

  const updatePOStatus = async (poId,newStatus) => {
    await supabase.from('purchase_orders').update({ status:newStatus }).eq('id',poId);
    await fetchAll();
  };

  const addCN = async () => {
    if (!cnForm.po_id||!cnForm.cn_date) { showToast('Please fill all required fields'); return; }
    const po=pos.find(p=>p.id===cnForm.po_id);
    if (!po) return;
    setSaving(true);
    const { data:idData } = await supabase.rpc('next_cn_id');
    const { error } = await supabase.from('credit_notes').insert([{ id:idData, po_id:cnForm.po_id, customer_id:po.customer_id, type:cnForm.type, amount:Number(cnForm.amount||0), foc_units:Number(cnForm.foc_units||0), cn_date:cnForm.cn_date, note:cnForm.note }]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Credit Note / FOC added ✓'); setCnForm({ po_id:'',type:'CNNote',amount:'',foc_units:'',cn_date:'',note:'' }); await fetchAll(); }
    setSaving(false);
  };

  const saveSettings = async () => {
    if (!settingsForm.exw||!settingsForm.ddp) { showToast('Please enter both prices'); return; }
    setSaving(true);
    const { error } = await supabase.from('settings').upsert([
      { key:'default_purchase_price_exw', value:String(settingsForm.exw), label:'Default Purchase Price — EXW (₹)', updated_at:new Date().toISOString() },
      { key:'default_purchase_price_ddp', value:String(settingsForm.ddp), label:'Default Purchase Price — DDP (₹)', updated_at:new Date().toISOString() },
    ],{ onConflict:'key' });
    if (error) showToast('Error: '+error.message);
    else { showToast('MSA prices updated ✓ — new POs will use updated defaults'); await fetchAll(); }
    setSaving(false);
  };

  const analytics = useMemo(()=>{
    const totalSalesGross   = pos.reduce((s,p)=>s+p.qty*p.unit_price,0);
    const totalUnits        = pos.reduce((s,p)=>s+p.qty,0);
    const totalAdvances     = pos.reduce((s,p)=>s+Number(p.advance),0);
    const totalCNValue      = cns.filter(c=>c.type==='CNNote').reduce((s,c)=>s+Number(c.amount),0);
    const totalFOCUnits     = cns.filter(c=>c.type==='FOC').reduce((s,c)=>s+c.foc_units,0);
    const totalFOCCost      = cns.filter(c=>c.type==='FOC').reduce((s,c)=>{ const po=pos.find(p=>p.id===c.po_id); return s+c.foc_units*Number(po?.purchase_price||0); },0);
    const totalNetSales     = totalSalesGross-totalCNValue;
    const totalPurchaseCost = pos.reduce((s,p)=>s+p.qty*Number(p.purchase_price),0)+totalFOCCost;
    const totalProfit       = totalNetSales-totalPurchaseCost;
    const pendingAdvance    = pos.filter(p=>p.status==='Advance Pending').reduce((s,p)=>s+(p.qty*p.unit_price-p.advance),0);
    const avgSellingPrice   = totalUnits>0?totalNetSales/totalUnits:0;

    const perCustomer = customers.map(cust=>{
      const custPOs=pos.filter(p=>p.customer_id===cust.id);
      const custCNs=cns.filter(c=>c.customer_id===cust.id);
      const grossSales=custPOs.reduce((s,p)=>s+p.qty*p.unit_price,0);
      const totalQty=custPOs.reduce((s,p)=>s+p.qty,0);
      const cnVal=custCNs.filter(c=>c.type==='CNNote').reduce((s,c)=>s+Number(c.amount),0);
      const focUnits=custCNs.filter(c=>c.type==='FOC').reduce((s,c)=>s+c.foc_units,0);
      const focCost=custCNs.filter(c=>c.type==='FOC').reduce((s,c)=>{ const po=pos.find(p=>p.id===c.po_id); return s+c.foc_units*Number(po?.purchase_price||0); },0);
      const netSales=grossSales-cnVal;
      const purchCost=custPOs.reduce((s,p)=>s+p.qty*Number(p.purchase_price),0)+focCost;
      const profit=netSales-purchCost;
      const avgSP=totalQty>0?netSales/totalQty:0;
      const avgPP=(totalQty+focUnits)>0?purchCost/(totalQty+focUnits):0;
      const margin=netSales>0?(profit/netSales)*100:0;
      const advance=custPOs.reduce((s,p)=>s+Number(p.advance),0);
      const pending=custPOs.filter(p=>p.status==='Advance Pending').reduce((s,p)=>s+(p.qty*p.unit_price-p.advance),0);
      const atRisk=totalQty>0&&avgSP<avgPP;
      return { ...cust,grossSales,totalQty,cnVal,focUnits,focCost,netSales,purchCost,profit,avgSP,avgPP,margin,advance,pending,atRisk };
    });
    return { totalSalesGross,totalUnits,totalAdvances,totalCNValue,totalFOCUnits,totalFOCCost,totalNetSales,totalPurchaseCost,totalProfit,pendingAdvance,avgSellingPrice,perCustomer };
  },[customers,pos,cns]);

  const simResult = useMemo(()=>{
    if (!sim.customerId) return null;
    const cust=analytics.perCustomer.find(c=>c.id===Number(sim.customerId));
    if (!cust) return null;
    const extraCN=Number(sim.extraCN||0), extraFOC=Number(sim.extraFOC||0);
    const focCostExt=extraFOC*settings.default_purchase_price_ddp;
    const newNet=cust.netSales-extraCN, newCost=cust.purchCost+focCostExt;
    const newProfit=newNet-newCost, newAvgSP=cust.totalQty>0?newNet/cust.totalQty:0;
    const newMargin=newNet>0?(newProfit/newNet)*100:0;
    const newAvgPP=(cust.totalQty+cust.focUnits+extraFOC)>0?newCost/(cust.totalQty+cust.focUnits+extraFOC):0;
    return { cust,extraCN,extraFOC,focCostExt,newNet,newCost,newProfit,newAvgSP,newMargin,willLoss:newAvgSP<newAvgPP };
  },[sim,analytics,settings]);

  const inp  = { width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:8,padding:'10px 12px',color:'#e2e8f0',fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:'none' };
  const lbl  = { display:'block',fontSize:11,fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.1em',color:'#64748b',marginBottom:5 };
  const card = { background:'#0f172a',border:'1px solid #1e293b',borderRadius:16 };
  const btn  = dis => ({ background:'#f59e0b',color:'#0a0e1a',fontWeight:700,border:'none',borderRadius:8,padding:'11px 24px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:12,opacity:dis?0.6:1 });
  const g4   = { display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14 };

  const navItems=[{key:'dashboard',label:'📊 Dashboard'},{key:'pos',label:'📋 Purchase Orders'},{key:'cns',label:'🔖 CN / FOC'},{key:'customers',label:'👤 Customers'},{key:'simulator',label:'🔮 Simulator'},{key:'settings',label:'⚙️ Settings'}];

  return (
    <div style={{ fontFamily:"'DM Sans','Segoe UI',sans-serif",background:'#0a0e1a',minHeight:'100vh',color:'#e2e8f0' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:6px;} ::-webkit-scrollbar-track{background:#0a0e1a;} ::-webkit-scrollbar-thumb{background:#334155;border-radius:3px;}
        .kc{background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid #334155;border-radius:16px;padding:20px;transition:transform .2s,box-shadow .2s;}
        .kc:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,.4);}
        .nb{background:transparent;border:none;cursor:pointer;padding:10px 16px;border-radius:8px;font-size:13px;font-family:'DM Sans',sans-serif;color:#94a3b8;transition:all .15s;white-space:nowrap;}
        .nb.active{background:#1e293b;color:#f59e0b;border:1px solid #334155;}
        .nb:hover:not(.active){background:#1e293b50;color:#e2e8f0;}
        table{width:100%;border-collapse:collapse;}
        th{font-size:11px;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.08em;color:#64748b;padding:10px 12px;text-align:left;border-bottom:1px solid #1e293b;}
        td{font-size:13px;padding:10px 12px;border-bottom:1px solid #1e293b40;vertical-align:middle;}
        tr:hover td{background:#1e293b50;}
        .sec{font-size:11px;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.12em;color:#64748b;margin-bottom:16px;}
        select option{background:#1e293b;}
        input:focus,select:focus{border-color:#f59e0b!important;outline:none;}
      `}</style>

      {toast && <div style={{ position:'fixed',top:20,right:20,background:'#052e16',border:'1px solid #14532d',color:'#34d399',padding:'12px 20px',borderRadius:10,fontFamily:"'DM Mono',monospace",fontSize:13,zIndex:9999,boxShadow:'0 8px 24px rgba(0,0,0,.5)' }}>{toast}</div>}

      {/* Header */}
      <div style={{ background:'linear-gradient(90deg,#0f172a,#1e293b)',borderBottom:'1px solid #1e293b',padding:'0 24px' }}>
        <div style={{ display:'flex',alignItems:'center',gap:16,height:60 }}>
          <div style={{ fontSize:22 }}>☀️</div>
          <div>
            <div style={{ fontFamily:"'DM Mono',monospace",fontSize:13,color:'#f59e0b',letterSpacing:'0.1em' }}>SOLAR INVERTER ERP</div>
            <div style={{ fontSize:11,color:'#475569',fontFamily:"'DM Mono',monospace" }}>DISTRIBUTOR MANAGEMENT SYSTEM</div>
          </div>
          <div style={{ marginLeft:'auto',display:'flex',gap:4,alignItems:'center' }}>
            {navItems.map(n=><button key={n.key} className={`nb ${view===n.key?'active':''}`} onClick={()=>setView(n.key)}>{n.label}</button>)}
            <div style={{ width:1,height:24,background:'#1e293b',margin:'0 8px' }}/>
            <div style={{ fontSize:12,color:'#475569',fontFamily:"'DM Mono',monospace",marginRight:8 }}>{user?.email}</div>
            <button onClick={signOut} style={{ background:'transparent',border:'1px solid #334155',color:'#64748b',borderRadius:6,padding:'6px 12px',cursor:'pointer',fontSize:12,fontFamily:"'DM Mono',monospace" }}>Sign Out</button>
          </div>
        </div>
      </div>

      <div style={{ padding:'28px',maxWidth:1500,margin:'0 auto' }}>
        {loading ? <Spinner/> : (<>

        {/* ═══ DASHBOARD ═══ */}
        {view==='dashboard' && (<div>
          <div className="sec">Executive Overview — All Time</div>
          <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:28 }}>
            {[
              {label:'Gross Sales',val:fmtC(analytics.totalSalesGross),sub:`${fmt(analytics.totalUnits)} units invoiced`,color:'#f59e0b'},
              {label:'Net Sales (after CN)',val:fmtC(analytics.totalNetSales),sub:`CN deducted: ${fmtC(analytics.totalCNValue)}`,color:'#38bdf8'},
              {label:'Total Purchase Cost',val:fmtC(analytics.totalPurchaseCost),sub:`Incl. FOC: ${fmtC(analytics.totalFOCCost)}`,color:'#a78bfa'},
              {label:'Net Profit',val:fmtC(analytics.totalProfit),sub:`Margin: ${pct((analytics.totalProfit/analytics.totalNetSales)*100)}`,color:analytics.totalProfit>=0?'#34d399':'#f87171'},
              {label:'Total Advances Received',val:fmtC(analytics.totalAdvances),sub:'from customers (100% advance)',color:'#34d399'},
              {label:'Pending Collections',val:fmtC(analytics.pendingAdvance),sub:'balance due',color:analytics.pendingAdvance>0?'#f87171':'#34d399'},
              {label:'Avg Selling Price / Unit',val:fmtC(analytics.avgSellingPrice),sub:`MSA: EXW ${fmtC(settings.default_purchase_price_exw)} · DDP ${fmtC(settings.default_purchase_price_ddp)}`,color:'#fb923c'},
              {label:'FOC Units Given',val:fmt(analytics.totalFOCUnits),sub:`Cost borne: ${fmtC(analytics.totalFOCCost)}`,color:'#e879f9'},
            ].map(k=>(
              <div key={k.label} className="kc">
                <div style={{ fontSize:11,color:'#64748b',fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10 }}>{k.label}</div>
                <div style={{ fontFamily:"'DM Mono',monospace",fontSize:26,fontWeight:500,color:k.color,lineHeight:1 }}>{k.val}</div>
                <div style={{ fontSize:11,color:'#475569',marginTop:6 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          <div className="sec">Customer-wise Profitability</div>
          <div style={{ ...card,overflow:'hidden',marginBottom:28 }}>
            <table>
              <thead><tr>{['Customer','Units','Gross Sales','Credit Notes','FOC Units','Net Sales','Purchase Cost','Net Profit','Margin %','Avg SP','Avg PP','Pending','Alert'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{analytics.perCustomer.map(c=>(
                <tr key={c.id}>
                  <td style={{ fontWeight:500,color:'#f1f5f9' }}>{c.name}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{c.totalQty}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(c.grossSales)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#f87171' }}>{fmtC(c.cnVal)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#e879f9' }}>{c.focUnits}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#38bdf8' }}>{fmtC(c.netSales)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(c.purchCost)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:c.profit>=0?'#34d399':'#f87171',fontWeight:600 }}>{fmtC(c.profit)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:c.margin>=0?'#34d399':'#f87171' }}>{pct(c.margin)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(c.avgSP)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(c.avgPP)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:c.pending>0?'#f87171':'#34d399' }}>{fmtC(c.pending)}</td>
                  <td>{c.atRisk?<span style={{ fontSize:11,background:'#450a0a',color:'#f87171',border:'1px solid #7f1d1d',borderRadius:6,padding:'2px 8px',fontFamily:"'DM Mono',monospace" }}>⚠ AT RISK</span>:<span style={{ fontSize:11,background:'#052e16',color:'#34d399',border:'1px solid #14532d',borderRadius:6,padding:'2px 8px',fontFamily:"'DM Mono',monospace" }}>✓ HEALTHY</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <div className="sec">Profitability Alerts</div>
          {analytics.perCustomer.filter(c=>c.atRisk).length===0
            ? <div style={{ color:'#34d399',fontSize:13 }}>✓ All customers are above break-even. No alerts.</div>
            : analytics.perCustomer.filter(c=>c.atRisk).map(c=><AlertBox key={c.id} msg={`${c.name} — Avg selling price (${fmtC(c.avgSP)}) has fallen BELOW avg purchase cost (${fmtC(c.avgPP)}).`}/>)
          }
        </div>)}

        {/* ═══ PURCHASE ORDERS ═══ */}
        {view==='pos' && (<div>
          <div className="sec">Purchase Orders</div>
          <div style={{ ...card,padding:20,marginBottom:24 }}>
            <div style={{ fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:14 }}>+ NEW PURCHASE ORDER</div>
            {/* Row 1 — sales details */}
            <div style={{ ...g4,marginBottom:14 }}>
              <div><label style={lbl}>Customer *</label>
                <select style={inp} value={poForm.customer_id} onChange={e=>setPoForm({...poForm,customer_id:e.target.value})}>
                  <option value="">Select…</option>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Delivery Type *</label>
                <select style={inp} value={poForm.delivery_type} onChange={e=>handleDeliveryChange(e.target.value)}>
                  <option value="DDP">DDP</option><option value="EXW">EXW</option>
                </select>
              </div>
              <div><label style={lbl}>Qty (Units) *</label>
                <input style={inp} type="number" placeholder="e.g. 10" value={poForm.qty} onChange={e=>setPoForm({...poForm,qty:e.target.value})}/>
              </div>
              <div><label style={lbl}>Unit Selling Price (₹) *</label>
                <input style={inp} type="number" placeholder="e.g. 470000" value={poForm.unit_price} onChange={e=>setPoForm({...poForm,unit_price:e.target.value})}/>
              </div>
            </div>
            {/* Row 2 — vendor / purchase details */}
            <div style={{ background:'#0a0e1a',border:'1px solid #334155',borderRadius:10,padding:16,marginBottom:14 }}>
              <div style={{ fontSize:11,color:'#6366f1',fontFamily:"'DM Mono',monospace",marginBottom:12 }}>PURCHASE / VENDOR DETAILS</div>
              <div style={{ ...g4 }}>
                <div><label style={lbl}>Vendor Name *</label>
                  <input style={{ ...inp,borderColor:poForm.vendor_name!=='Primary Manufacturer'?'#6366f1':'#334155' }}
                    type="text" placeholder="Primary Manufacturer" value={poForm.vendor_name}
                    onChange={e=>setPoForm({...poForm,vendor_name:e.target.value})}/>
                </div>
                <div><label style={lbl}>Actual Purchase Price / Unit (₹) *</label>
                  <input style={{ ...inp,borderColor:Number(poForm.purchase_price)!==(poForm.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw)&&poForm.purchase_price?'#6366f1':'#334155' }}
                    type="number"
                    placeholder={`Default: ${fmtC(poForm.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw)}`}
                    value={poForm.purchase_price}
                    onChange={e=>setPoForm({...poForm,purchase_price:e.target.value})}/>
                  {Number(poForm.purchase_price)!==(poForm.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw)&&poForm.purchase_price&&
                    <div style={{ fontSize:11,color:'#6366f1',marginTop:4 }}>⚡ Non-MSA price</div>}
                </div>
                <div><label style={lbl}>Vendor Invoice No.</label>
                  <input style={inp} type="text" placeholder="e.g. INV-2024-001" value={poForm.vendor_invoice_no} onChange={e=>setPoForm({...poForm,vendor_invoice_no:e.target.value})}/>
                </div>
                <div><label style={lbl}>Purchase Date</label>
                  <input style={inp} type="date" value={poForm.purchase_date} onChange={e=>setPoForm({...poForm,purchase_date:e.target.value})}/>
                </div>
              </div>
            </div>
            {/* Row 3 — advance, date, status, submit */}
            <div style={{ ...g4 }}>
              <div><label style={lbl}>Advance Received (₹) *</label>
                <input style={inp} type="number" placeholder="100% advance" value={poForm.advance} onChange={e=>setPoForm({...poForm,advance:e.target.value})}/>
              </div>
              <div><label style={lbl}>PO Date *</label>
                <input style={inp} type="date" value={poForm.po_date} onChange={e=>setPoForm({...poForm,po_date:e.target.value})}/>
              </div>
              <div><label style={lbl}>Status</label>
                <select style={inp} value={poForm.status} onChange={e=>setPoForm({...poForm,status:e.target.value})}>
                  {['Advance Pending','In Transit','Fulfilled'].map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display:'flex',alignItems:'flex-end' }}>
                <button onClick={addPO} disabled={saving} style={{ ...btn(saving),width:'100%',padding:'11px 0' }}>{saving?'Saving…':'ADD PO →'}</button>
              </div>
            </div>
            {/* Live preview */}
            {poForm.qty&&poForm.unit_price&&poForm.purchase_price&&(
              <div style={{ marginTop:14,background:'#0a0e1a',borderRadius:8,padding:'10px 16px',fontSize:12,color:'#94a3b8',fontFamily:"'DM Mono',monospace",display:'flex',gap:24,flexWrap:'wrap' }}>
                <span>Gross Invoice: <strong style={{ color:'#f1f5f9' }}>{fmtC(poForm.qty*poForm.unit_price)}</strong></span>
                <span>Purchase Cost: <strong style={{ color:'#f1f5f9' }}>{fmtC(poForm.qty*poForm.purchase_price)}</strong></span>
                <span>Gross Profit: <strong style={{ color:(poForm.qty*poForm.unit_price-poForm.qty*poForm.purchase_price)>=0?'#34d399':'#f87171' }}>{fmtC(poForm.qty*poForm.unit_price-poForm.qty*poForm.purchase_price)}</strong></span>
                <span>Margin: <strong style={{ color:(poForm.qty*poForm.unit_price-poForm.qty*poForm.purchase_price)>=0?'#34d399':'#f87171' }}>{pct(((poForm.qty*poForm.unit_price-poForm.qty*poForm.purchase_price)/(poForm.qty*poForm.unit_price))*100)}</strong></span>
              </div>
            )}
          </div>

          <div style={{ ...card,overflow:'auto' }}>
            <table>
              <thead><tr>{['PO No','Customer','Type','Vendor','Purch. Price','Qty','Sell Price','Gross Value','Advance','Balance','Date','Status','Update'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{pos.map(p=>{
                const cust=customers.find(c=>c.id===p.customer_id);
                const gross=p.qty*p.unit_price, bal=gross-p.advance;
                const isAlt=p.vendor_name&&p.vendor_name!=='Primary Manufacturer';
                return (<tr key={p.id}>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#f59e0b' }}>{p.id}</td>
                  <td style={{ fontWeight:500 }}>{cust?.name||'—'}</td>
                  <td><span style={{ fontFamily:"'DM Mono',monospace",fontSize:11,background:p.delivery_type==='DDP'?'#1e3a5f':'#1e3a2f',color:p.delivery_type==='DDP'?'#38bdf8':'#34d399',borderRadius:4,padding:'2px 8px' }}>{p.delivery_type}</span></td>
                  <td>
                    <div>{p.vendor_name||'Primary Manufacturer'}</div>
                    {isAlt&&<div style={{ fontSize:10,color:'#6366f1',fontFamily:"'DM Mono',monospace" }}>⚡ ALT VENDOR</div>}
                    {p.vendor_invoice_no&&<div style={{ fontSize:11,color:'#475569' }}>{p.vendor_invoice_no}</div>}
                  </td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:isAlt?'#6366f1':'#94a3b8' }}>{fmtC(p.purchase_price)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{p.qty}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(p.unit_price)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(gross)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#34d399' }}>{fmtC(p.advance)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:bal>0?'#f87171':'#34d399' }}>{fmtC(bal)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#64748b' }}>{p.po_date}</td>
                  <td><StatusBadge s={p.status}/></td>
                  <td><select style={{ ...inp,width:'auto',fontSize:11,padding:'4px 8px' }} value={p.status} onChange={e=>updatePOStatus(p.id,e.target.value)}>
                    {['Advance Pending','In Transit','Fulfilled'].map(s=><option key={s}>{s}</option>)}
                  </select></td>
                </tr>);
              })}</tbody>
            </table>
          </div>
        </div>)}

        {/* ═══ CREDIT NOTES ═══ */}
        {view==='cns' && (<div>
          <div className="sec">Credit Notes & FOC Units</div>
          <div style={{ ...card,padding:20,marginBottom:24 }}>
            <div style={{ fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:14 }}>+ NEW CREDIT NOTE / FOC</div>
            <div style={{ ...g4 }}>
              <div><label style={lbl}>Linked PO *</label>
                <select style={inp} value={cnForm.po_id} onChange={e=>setCnForm({...cnForm,po_id:e.target.value})}>
                  <option value="">Select PO…</option>
                  {pos.map(p=>{ const c=customers.find(x=>x.id===p.customer_id); return <option key={p.id} value={p.id}>{p.id} — {c?.name}</option>; })}
                </select>
              </div>
              <div><label style={lbl}>Type *</label>
                <select style={inp} value={cnForm.type} onChange={e=>setCnForm({...cnForm,type:e.target.value})}>
                  <option value="CNNote">Credit Note (Volume Discount)</option>
                  <option value="FOC">FOC Units (Free of Cost)</option>
                </select>
              </div>
              {cnForm.type==='CNNote'&&<div><label style={lbl}>CN Amount (₹)</label><input style={inp} type="number" placeholder="e.g. 150000" value={cnForm.amount} onChange={e=>setCnForm({...cnForm,amount:e.target.value})}/></div>}
              {cnForm.type==='FOC'&&<div><label style={lbl}>FOC Units</label><input style={inp} type="number" placeholder="e.g. 1" value={cnForm.foc_units} onChange={e=>setCnForm({...cnForm,foc_units:e.target.value})}/></div>}
              <div><label style={lbl}>Date *</label><input style={inp} type="date" value={cnForm.cn_date} onChange={e=>setCnForm({...cnForm,cn_date:e.target.value})}/></div>
              <div><label style={lbl}>Note / Remarks</label><input style={inp} type="text" placeholder="e.g. Q1 rebate" value={cnForm.note} onChange={e=>setCnForm({...cnForm,note:e.target.value})}/></div>
              <div style={{ display:'flex',alignItems:'flex-end' }}>
                <button onClick={addCN} disabled={saving} style={{ ...btn(saving),width:'100%',padding:'11px 0' }}>{saving?'Saving…':'ADD →'}</button>
              </div>
            </div>
          </div>
          <div style={{ ...card,overflow:'hidden' }}>
            <table>
              <thead><tr>{['CN/FOC No','Linked PO','Customer','Type','CN Amount','FOC Units','FOC Cost (to me)','Date','Remarks'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{cns.map(c=>{ const cust=customers.find(x=>x.id===c.customer_id); const po=pos.find(p=>p.id===c.po_id); const focCost=c.type==='FOC'?c.foc_units*Number(po?.purchase_price||0):0; return (
                <tr key={c.id}>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#f59e0b' }}>{c.id}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{c.po_id}</td>
                  <td>{cust?.name||'—'}</td>
                  <td><span style={{ fontFamily:"'DM Mono',monospace",fontSize:11,background:c.type==='CNNote'?'#2d1f3d':'#1f2d1f',color:c.type==='CNNote'?'#c084fc':'#4ade80',borderRadius:4,padding:'2px 8px' }}>{c.type==='CNNote'?'Credit Note':'FOC'}</span></td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#f87171' }}>{c.type==='CNNote'?fmtC(c.amount):'—'}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#e879f9' }}>{c.type==='FOC'?c.foc_units:'—'}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#f87171' }}>{c.type==='FOC'?fmtC(focCost):'—'}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#64748b' }}>{c.cn_date}</td>
                  <td style={{ color:'#94a3b8',fontSize:12 }}>{c.note}</td>
                </tr>
              );})}</tbody>
            </table>
          </div>
        </div>)}

        {/* ═══ CUSTOMERS ═══ */}
        {view==='customers' && (<div>
          <div className="sec">Customer Master</div>
          <div style={{ ...card,padding:20,marginBottom:24 }}>
            <div style={{ fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:14 }}>+ ADD CUSTOMER</div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:14,alignItems:'flex-end' }}>
              <div><label style={lbl}>Customer Name</label><input style={inp} type="text" placeholder="Company name" value={custForm.name} onChange={e=>setCustForm({...custForm,name:e.target.value})}/></div>
              <div><label style={lbl}>GSTIN</label><input style={inp} type="text" placeholder="27AABCS1429B1ZB" value={custForm.gstin} onChange={e=>setCustForm({...custForm,gstin:e.target.value})}/></div>
              <button onClick={addCustomer} disabled={saving} style={btn(saving)}>{saving?'Saving…':'ADD →'}</button>
            </div>
          </div>
          <div style={{ ...card,overflow:'hidden' }}>
            <table>
              <thead><tr>{['#','Customer Name','GSTIN','Total POs','Net Sales','Net Profit','Margin','Status'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{customers.map((c,i)=>{ const a=analytics.perCustomer.find(x=>x.id===c.id); return (
                <tr key={c.id}>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#64748b' }}>{i+1}</td>
                  <td style={{ fontWeight:500,color:'#f1f5f9' }}>{c.name}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:12 }}>{c.gstin||'—'}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{pos.filter(p=>p.customer_id===c.id).length}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(a?.netSales||0)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:(a?.profit||0)>=0?'#34d399':'#f87171' }}>{fmtC(a?.profit||0)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{pct(a?.margin||0)}</td>
                  <td>{a?.atRisk?<span style={{ fontSize:11,background:'#450a0a',color:'#f87171',border:'1px solid #7f1d1d',borderRadius:6,padding:'2px 8px',fontFamily:"'DM Mono',monospace" }}>⚠ AT RISK</span>:<span style={{ fontSize:11,background:'#052e16',color:'#34d399',border:'1px solid #14532d',borderRadius:6,padding:'2px 8px',fontFamily:"'DM Mono',monospace" }}>✓ HEALTHY</span>}</td>
                </tr>
              );})}</tbody>
            </table>
          </div>
        </div>)}

        {/* ═══ SIMULATOR ═══ */}
        {view==='simulator' && (<div>
          <div className="sec">Discount Simulator</div>
          <div style={{ ...card,padding:24,marginBottom:24,maxWidth:700 }}>
            <div style={{ fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:16 }}>MODEL A FUTURE DISCOUNT / FOC SCENARIO</div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16 }}>
              <div><label style={lbl}>Select Customer</label>
                <select style={inp} value={sim.customerId} onChange={e=>setSim({...sim,customerId:e.target.value})}>
                  <option value="">Select…</option>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Additional CN Amount (₹)</label><input style={inp} type="number" placeholder="e.g. 100000" value={sim.extraCN} onChange={e=>setSim({...sim,extraCN:e.target.value})}/></div>
              <div><label style={lbl}>Additional FOC Units</label><input style={inp} type="number" placeholder="e.g. 1" value={sim.extraFOC} onChange={e=>setSim({...sim,extraFOC:e.target.value})}/></div>
            </div>
          </div>
          {simResult&&(<div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,maxWidth:900 }}>
            <div style={{ ...card,padding:24 }}>
              <div style={{ fontSize:11,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:16,textTransform:'uppercase' }}>Current — {simResult.cust.name}</div>
              {[['Net Sales',fmtC(simResult.cust.netSales),'#38bdf8'],['Purchase Cost',fmtC(simResult.cust.purchCost),'#94a3b8'],['Net Profit',fmtC(simResult.cust.profit),simResult.cust.profit>=0?'#34d399':'#f87171'],['Margin',pct(simResult.cust.margin),simResult.cust.margin>=0?'#34d399':'#f87171'],['Avg Sell Price',fmtC(simResult.cust.avgSP),'#f59e0b'],['Avg Buy Price',fmtC(simResult.cust.avgPP),'#94a3b8']].map(([l,v,c])=>(
                <div key={l} style={{ display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #1e293b' }}>
                  <span style={{ fontSize:13,color:'#64748b' }}>{l}</span>
                  <span style={{ fontFamily:"'DM Mono',monospace",fontSize:13,color:c }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ ...card,border:`1px solid ${simResult.willLoss?'#7f1d1d':'#14532d'}`,padding:24 }}>
              <div style={{ fontSize:11,color:simResult.willLoss?'#f87171':'#34d399',fontFamily:"'DM Mono',monospace",marginBottom:16,textTransform:'uppercase' }}>
                {simResult.willLoss?'⚠ AFTER SCENARIO — LOSS TERRITORY':'✓ AFTER SCENARIO — STILL PROFITABLE'}
              </div>
              {[['Net Sales (after CN)',fmtC(simResult.newNet),'#38bdf8'],['Total Cost (incl FOC)',fmtC(simResult.newCost),'#94a3b8'],['Net Profit',fmtC(simResult.newProfit),simResult.newProfit>=0?'#34d399':'#f87171'],['Margin',pct(simResult.newMargin),simResult.newMargin>=0?'#34d399':'#f87171'],['Extra CN Impact',`- ${fmtC(simResult.extraCN)}`,'#f87171'],['Extra FOC Cost',`- ${fmtC(simResult.focCostExt)}`,'#f87171']].map(([l,v,c])=>(
                <div key={l} style={{ display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #1e293b20' }}>
                  <span style={{ fontSize:13,color:'#64748b' }}>{l}</span>
                  <span style={{ fontFamily:"'DM Mono',monospace",fontSize:13,color:c }}>{v}</span>
                </div>
              ))}
              <div style={{ marginTop:16 }}>
                {simResult.willLoss
                  ?<AlertBox msg={`DO NOT AGREE — this will push ${simResult.cust.name} into LOSS.`}/>
                  :<div style={{ background:'#052e16',border:'1px solid #14532d',color:'#34d399',borderRadius:8,padding:'10px 14px',fontSize:12,fontFamily:"'DM Mono',monospace" }}>✓ Safe to proceed — you remain profitable.</div>}
              </div>
            </div>
          </div>)}
          {!simResult&&<div style={{ color:'#475569',fontSize:13 }}>← Select a customer and enter a proposed discount or FOC quantity.</div>}
        </div>)}

        {/* ═══ SETTINGS ═══ */}
        {view==='settings' && (<div style={{ maxWidth:620 }}>
          <div className="sec">Settings — MSA Default Purchase Prices</div>
          <div style={{ ...card,padding:28,marginBottom:20 }}>
            <div style={{ fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:6 }}>DEFAULT PURCHASE PRICES (MASTER SUPPLY AGREEMENT)</div>
            <div style={{ fontSize:13,color:'#64748b',marginBottom:24,lineHeight:1.7 }}>
              These prices auto-fill when your accountant adds a new PO. Update them at the start of each financial year. Existing POs are not affected — they retain the price that was entered at the time.
            </div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:24 }}>
              <div>
                <label style={lbl}>Default Purchase Price — EXW (₹)</label>
                <input style={inp} type="number" value={settingsForm.exw} onChange={e=>setSettingsForm({...settingsForm,exw:e.target.value})} placeholder="e.g. 400000"/>
                <div style={{ fontSize:11,color:'#475569',marginTop:4 }}>Current active: {fmtC(settings.default_purchase_price_exw)}</div>
              </div>
              <div>
                <label style={lbl}>Default Purchase Price — DDP (₹)</label>
                <input style={inp} type="number" value={settingsForm.ddp} onChange={e=>setSettingsForm({...settingsForm,ddp:e.target.value})} placeholder="e.g. 403000"/>
                <div style={{ fontSize:11,color:'#475569',marginTop:4 }}>Current active: {fmtC(settings.default_purchase_price_ddp)}</div>
              </div>
            </div>
            <button onClick={saveSettings} disabled={saving} style={btn(saving)}>{saving?'Saving…':'SAVE MSA PRICES →'}</button>
          </div>

          <div style={{ ...card,padding:20 }}>
            <div style={{ fontSize:12,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:12 }}>HOW PER-PO PRICING WORKS</div>
            {[
              ['Regular PO (primary manufacturer)','Purchase price auto-fills with the MSA default above'],
              ['Spot / alternate vendor purchase','Override the purchase price field — it turns purple to flag it as non-MSA'],
              ['New financial year price change','Update MSA prices here — all future POs use the new rate automatically'],
              ['Profit & margin calculation','Always uses the actual purchase price saved on each individual PO'],
              ['FOC unit cost','Calculated at the purchase price of the linked PO'],
            ].map(([k,v])=>(
              <div key={k} style={{ display:'flex',gap:16,padding:'10px 0',borderBottom:'1px solid #1e293b' }}>
                <div style={{ fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",minWidth:260,flexShrink:0 }}>{k}</div>
                <div style={{ fontSize:12,color:'#94a3b8' }}>{v}</div>
              </div>
            ))}
          </div>
        </div>)}

        </>)}
      </div>
    </div>
  );
}
