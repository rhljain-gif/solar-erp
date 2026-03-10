import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';

const fmt  = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
const fmtC = n => '₹' + fmt(n);
const pct  = n => isFinite(n) && !isNaN(n) ? n.toFixed(2) + '%' : '—';

const PO_STAGES = ['PO Received','Advance Received','Invoice Raised','Shipment Dispatched','Delivered / Fulfilled'];
const GST_RATES = [0, 5, 12, 18, 28];

const stageColor = s => {
  const m = {
    'PO Received':          { bg:'#1e1a3f', color:'#a78bfa', border:'#4c1d95' },
    'Advance Received':     { bg:'#1a2e3f', color:'#38bdf8', border:'#0c4a6e' },
    'Invoice Raised':       { bg:'#1f2d1f', color:'#4ade80', border:'#14532d' },
    'Shipment Dispatched':  { bg:'#451a03', color:'#fb923c', border:'#7c2d12' },
    'Delivered / Fulfilled':{ bg:'#052e16', color:'#34d399', border:'#14532d' },
  };
  return m[s] || { bg:'#1e293b', color:'#94a3b8', border:'#334155' };
};

const StatusBadge = ({ s }) => {
  const c = stageColor(s);
  return <span style={{ background:c.bg, color:c.color, border:`1px solid ${c.border}`, fontSize:11, padding:'2px 8px', borderRadius:6, fontFamily:"'DM Mono',monospace", whiteSpace:'nowrap' }}>{s}</span>;
};

const AlertBox = ({ msg }) => (
  <div style={{ display:'flex',alignItems:'center',gap:8,background:'#450a0a',border:'1px solid #7f1d1d',color:'#f87171',borderRadius:8,padding:'10px 14px',fontSize:12,fontFamily:"'DM Mono',monospace" }}>
    <span style={{ fontSize:16 }}>⚠</span> {msg}
  </div>
);

const Spinner = () => <div style={{ textAlign:'center',padding:40,color:'#475569',fontFamily:"'DM Mono',monospace",fontSize:13 }}>Loading…</div>;

// Stage progress bar
const StagePipeline = ({ current }) => {
  const idx = PO_STAGES.indexOf(current);
  return (
    <div style={{ display:'flex', alignItems:'center', gap:0 }}>
      {PO_STAGES.map((s,i) => {
        const done = i <= idx;
        const active = i === idx;
        return (
          <div key={s} style={{ display:'flex', alignItems:'center' }}>
            <div style={{ width:10, height:10, borderRadius:'50%', background: done ? '#34d399' : '#1e293b', border: active ? '2px solid #34d399' : '1px solid #334155', transition:'all 0.3s' }} title={s}/>
            {i < PO_STAGES.length-1 && <div style={{ width:16, height:2, background: i < idx ? '#34d399' : '#1e293b' }}/>}
          </div>
        );
      })}
    </div>
  );
};

export default function DashboardPage() {
  const { user, signOut } = useAuth();
  const [view,setView]           = useState('dashboard');
  const [customers,setCustomers] = useState([]);
  const [pos,setPos]             = useState([]);
  const [cns,setCns]             = useState([]);
  const [mfrCNs,setMfrCNs]       = useState([]);
  const [mfrExp,setMfrExp]       = useState([]);
  const [settings,setSettings]   = useState({ default_purchase_price_exw:400000, default_purchase_price_ddp:403000 });
  const [loading,setLoading]     = useState(true);
  const [saving,setSaving]       = useState(false);
  const [toast,setToast]         = useState('');
  const [expandedMfrCN,setExpandedMfrCN] = useState(null);

  // Forms
  const [poForm,setPoForm]       = useState({ customer_id:'',delivery_type:'DDP',qty:'',unit_price:'',purchase_price:'',vendor_name:'Primary Manufacturer',vendor_invoice_no:'',purchase_date:'',advance:'',po_date:'',status:'PO Received',invoice_no:'',invoice_date:'',dispatch_date:'' });
  const [cnForm,setCnForm]       = useState({ po_id:'',type:'CNNote',amount:'',foc_units:'',cn_date:'',note:'' });
  const [custForm,setCustForm]   = useState({ name:'',gstin:'' });
  const [sim,setSim]             = useState({ customerId:'',extraCN:'',extraFOC:'',newPoQty:'',newPoUnitPrice:'',newPoPurchasePrice:'',newPoCNAmount:'',newPoFOCUnits:'' });
  const [settingsForm,setSettingsForm] = useState({ exw:'',ddp:'' });
  const [mfrCNForm,setMfrCNForm] = useState({ cn_ref:'',cn_date:'',total_value:'',description:'' });
  const [expForm,setExpForm]     = useState({ mfr_cn_id:'',expense_name:'',expense_date:'',amount:'',gst_rate:'18',vendor_name:'',invoice_ref:'',notes:'' });

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3500); };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data:c },{ data:p },{ data:cn },{ data:s },{ data:mc },{ data:me }] = await Promise.all([
      supabase.from('customers').select('*').order('id'),
      supabase.from('purchase_orders').select('*').order('created_at'),
      supabase.from('credit_notes').select('*').order('created_at'),
      supabase.from('settings').select('*'),
      supabase.from('manufacturer_cns').select('*').order('cn_date', { ascending:false }),
      supabase.from('manufacturer_cn_expenses').select('*').order('expense_date', { ascending:false }),
    ]);
    setCustomers(c||[]);
    setPos(p||[]);
    setCns(cn||[]);
    setMfrCNs(mc||[]);
    setMfrExp(me||[]);
    if (s) {
      const parsed={};
      s.forEach(r=>{ parsed[r.key]=Number(r.value); });
      setSettings(parsed);
      setSettingsForm({ exw:parsed.default_purchase_price_exw, ddp:parsed.default_purchase_price_ddp });
    }
    setLoading(false);
  }, []);

  useEffect(()=>{ fetchAll(); },[fetchAll]);

  const handleDeliveryChange = type => {
    const def = type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw;
    setPoForm(f=>({ ...f, delivery_type:type, purchase_price:f.vendor_name==='Primary Manufacturer'?def:f.purchase_price }));
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
      purchase_date:poForm.purchase_date||null, advance:Number(poForm.advance),
      po_date:poForm.po_date, status:poForm.status,
      invoice_no:poForm.invoice_no||null, invoice_date:poForm.invoice_date||null, dispatch_date:poForm.dispatch_date||null,
    }]);
    if (error) showToast('Error: '+error.message);
    else {
      showToast('Purchase Order added ✓');
      const def = settings.default_purchase_price_ddp;
      setPoForm({ customer_id:'',delivery_type:'DDP',qty:'',unit_price:'',purchase_price:def,vendor_name:'Primary Manufacturer',vendor_invoice_no:'',purchase_date:'',advance:'',po_date:'',status:'PO Received',invoice_no:'',invoice_date:'',dispatch_date:'' });
      await fetchAll();
    }
    setSaving(false);
  };

  const updatePOStatus = async (poId, newStatus) => {
    await supabase.from('purchase_orders').update({ status:newStatus }).eq('id',poId);
    await fetchAll();
  };

  const updatePOField = async (poId, field, value) => {
    await supabase.from('purchase_orders').update({ [field]:value||null }).eq('id',poId);
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
    else { showToast('Added ✓'); setCnForm({ po_id:'',type:'CNNote',amount:'',foc_units:'',cn_date:'',note:'' }); await fetchAll(); }
    setSaving(false);
  };

  const addMfrCN = async () => {
    if (!mfrCNForm.cn_ref||!mfrCNForm.cn_date||!mfrCNForm.total_value) { showToast('Please fill all required fields'); return; }
    setSaving(true);
    const { error } = await supabase.from('manufacturer_cns').insert([{ cn_ref:mfrCNForm.cn_ref, cn_date:mfrCNForm.cn_date, total_value:Number(mfrCNForm.total_value), description:mfrCNForm.description }]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Manufacturer CN added ✓'); setMfrCNForm({ cn_ref:'',cn_date:'',total_value:'',description:'' }); await fetchAll(); }
    setSaving(false);
  };

  const addExpense = async () => {
    if (!expForm.mfr_cn_id||!expForm.expense_name||!expForm.expense_date||!expForm.amount) { showToast('Please fill all required fields'); return; }
    setSaving(true);
    const amt = Number(expForm.amount);
    const gstRate = Number(expForm.gst_rate||0);
    const gstAmt = parseFloat((amt * gstRate / 100).toFixed(2));
    const total = parseFloat((amt + gstAmt).toFixed(2));
    const { error } = await supabase.from('manufacturer_cn_expenses').insert([{
      mfr_cn_id:Number(expForm.mfr_cn_id), expense_name:expForm.expense_name,
      expense_date:expForm.expense_date, amount:amt, gst_rate:gstRate,
      gst_amount:gstAmt, total_amount:total,
      vendor_name:expForm.vendor_name, invoice_ref:expForm.invoice_ref, notes:expForm.notes,
    }]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Expense added ✓'); setExpForm({ mfr_cn_id:expForm.mfr_cn_id,expense_name:'',expense_date:'',amount:'',gst_rate:'18',vendor_name:'',invoice_ref:'',notes:'' }); await fetchAll(); }
    setSaving(false);
  };

  const saveSettings = async () => {
    if (!settingsForm.exw||!settingsForm.ddp) return;
    setSaving(true);
    const { error } = await supabase.from('settings').upsert([
      { key:'default_purchase_price_exw',value:String(settingsForm.exw),label:'Default Purchase Price — EXW (₹)',updated_at:new Date().toISOString() },
      { key:'default_purchase_price_ddp',value:String(settingsForm.ddp),label:'Default Purchase Price — DDP (₹)',updated_at:new Date().toISOString() },
    ],{ onConflict:'key' });
    if (error) showToast('Error: '+error.message);
    else { showToast('MSA prices updated ✓'); await fetchAll(); }
    setSaving(false);
  };

  // ── Analytics ──────────────────────────────────────────────────────────────
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
    const pendingAdvance    = pos.filter(p=>p.status!=='Delivered / Fulfilled').reduce((s,p)=>s+Math.max(0,p.qty*p.unit_price-p.advance),0);
    const avgSellingPrice   = totalUnits>0?totalNetSales/totalUnits:0;
    const unfulfilled       = pos.filter(p=>p.status!=='Delivered / Fulfilled');

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
      const pending=custPOs.filter(p=>p.status!=='Delivered / Fulfilled').reduce((s,p)=>s+Math.max(0,p.qty*p.unit_price-p.advance),0);
      const atRisk=totalQty>0&&avgSP<avgPP;
      return { ...cust,grossSales,totalQty,cnVal,focUnits,focCost,netSales,purchCost,profit,avgSP,avgPP,margin,advance,pending,atRisk };
    });

    return { totalSalesGross,totalUnits,totalAdvances,totalCNValue,totalFOCUnits,totalFOCCost,totalNetSales,totalPurchaseCost,totalProfit,pendingAdvance,avgSellingPrice,perCustomer,unfulfilled };
  },[customers,pos,cns]);

  // ── Simulator (enhanced) ───────────────────────────────────────────────────
  const simResult = useMemo(()=>{
    if (!sim.customerId) return null;
    const cust=analytics.perCustomer.find(c=>c.id===Number(sim.customerId));
    if (!cust) return null;

    // Existing position
    const extraCN=Number(sim.extraCN||0), extraFOC=Number(sim.extraFOC||0);

    // New PO scenario
    const newQty=Number(sim.newPoQty||0);
    const newUnitPrice=Number(sim.newPoUnitPrice||0);
    const newPurchPrice=Number(sim.newPoPurchasePrice||settings.default_purchase_price_ddp);
    const newCNAmount=Number(sim.newPoCNAmount||0);
    const newFOCUnits=Number(sim.newPoFOCUnits||0);

    const hasNewPO = newQty>0 && newUnitPrice>0;

    // Combined existing + new PO
    const combinedGross  = cust.grossSales + (hasNewPO ? newQty*newUnitPrice : 0);
    const combinedCNVal  = cust.cnVal + extraCN + newCNAmount;
    const combinedFOCCost= cust.focCost + extraFOC*settings.default_purchase_price_ddp + newFOCUnits*newPurchPrice;
    const combinedPurchCost = cust.purchCost - cust.focCost + (hasNewPO ? newQty*newPurchPrice : 0) + combinedFOCCost;
    const combinedNetSales = combinedGross - combinedCNVal;
    const combinedProfit = combinedNetSales - combinedPurchCost;
    const combinedTotalQty = cust.totalQty + (hasNewPO?newQty:0);
    const combinedFOCUnits = cust.focUnits + extraFOC + newFOCUnits;
    const combinedAvgSP = combinedTotalQty>0 ? combinedNetSales/combinedTotalQty : 0;
    const combinedAvgPP = (combinedTotalQty+combinedFOCUnits)>0 ? combinedPurchCost/(combinedTotalQty+combinedFOCUnits) : 0;
    const combinedMargin = combinedNetSales>0 ? (combinedProfit/combinedNetSales)*100 : 0;
    const willLoss = combinedAvgSP < combinedAvgPP;

    // New PO standalone profit
    const newPOGrossProfit = hasNewPO ? (newQty*newUnitPrice - newCNAmount) - (newQty*newPurchPrice + newFOCUnits*newPurchPrice) : 0;

    return { cust, extraCN, extraFOC, hasNewPO, newQty, newUnitPrice, newPurchPrice, newCNAmount, newFOCUnits,
             combinedGross, combinedCNVal, combinedNetSales, combinedPurchCost, combinedProfit,
             combinedAvgSP, combinedAvgPP, combinedMargin, combinedTotalQty, willLoss, newPOGrossProfit };
  },[sim,analytics,settings]);

  // ── Manufacturer CN analytics ──────────────────────────────────────────────
  const mfrCNAnalytics = useMemo(()=>{
    return mfrCNs.map(cn=>{
      const expenses = mfrExp.filter(e=>e.mfr_cn_id===cn.id);
      const totalUsed = expenses.reduce((s,e)=>s+Number(e.total_amount),0);
      const balance = Number(cn.total_value) - totalUsed;
      return { ...cn, expenses, totalUsed, balance };
    });
  },[mfrCNs,mfrExp]);

  // ── Styles ─────────────────────────────────────────────────────────────────
  const inp  = { width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:8,padding:'10px 12px',color:'#e2e8f0',fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:'none' };
  const lbl  = { display:'block',fontSize:11,fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.1em',color:'#64748b',marginBottom:5 };
  const card = { background:'#0f172a',border:'1px solid #1e293b',borderRadius:16 };
  const btn  = dis => ({ background:'#f59e0b',color:'#0a0e1a',fontWeight:700,border:'none',borderRadius:8,padding:'11px 24px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:12,opacity:dis?0.6:1 });
  const g4   = { display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14 };
  const g3   = { display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14 };

  const navItems=[
    {key:'dashboard',label:'📊 Dashboard'},
    {key:'pos',label:'📋 Orders'},
    {key:'unfulfilled',label:'⏳ Pending Orders'},
    {key:'cns',label:'🔖 CN / FOC'},
    {key:'customers',label:'👤 Customers'},
    {key:'simulator',label:'🔮 Simulator'},
    {key:'mfrcn',label:'🏭 Mfr. CNs'},
    {key:'settings',label:'⚙️ Settings'},
  ];

  return (
    <div style={{ fontFamily:"'DM Sans','Segoe UI',sans-serif",background:'#0a0e1a',minHeight:'100vh',color:'#e2e8f0' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:6px;} ::-webkit-scrollbar-track{background:#0a0e1a;} ::-webkit-scrollbar-thumb{background:#334155;border-radius:3px;}
        .kc{background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid #334155;border-radius:16px;padding:20px;transition:transform .2s,box-shadow .2s;}
        .kc:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,.4);}
        .nb{background:transparent;border:none;cursor:pointer;padding:8px 14px;border-radius:8px;font-size:12px;font-family:'DM Sans',sans-serif;color:#94a3b8;transition:all .15s;white-space:nowrap;}
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

      {toast&&<div style={{ position:'fixed',top:20,right:20,background:'#052e16',border:'1px solid #14532d',color:'#34d399',padding:'12px 20px',borderRadius:10,fontFamily:"'DM Mono',monospace",fontSize:13,zIndex:9999,boxShadow:'0 8px 24px rgba(0,0,0,.5)' }}>{toast}</div>}

      {/* Header */}
      <div style={{ background:'linear-gradient(90deg,#0f172a,#1e293b)',borderBottom:'1px solid #1e293b',padding:'0 20px' }}>
        <div style={{ display:'flex',alignItems:'center',gap:12,height:56 }}>
          <div style={{ fontSize:20 }}>☀️</div>
          <div>
            <div style={{ fontFamily:"'DM Mono',monospace",fontSize:12,color:'#f59e0b',letterSpacing:'0.1em' }}>SOLAR INVERTER ERP</div>
            <div style={{ fontSize:10,color:'#475569',fontFamily:"'DM Mono',monospace" }}>DISTRIBUTOR MANAGEMENT</div>
          </div>
          <div style={{ marginLeft:'auto',display:'flex',gap:2,alignItems:'center',flexWrap:'wrap' }}>
            {navItems.map(n=><button key={n.key} className={`nb ${view===n.key?'active':''}`} onClick={()=>setView(n.key)}>{n.label}</button>)}
            <div style={{ width:1,height:20,background:'#1e293b',margin:'0 6px' }}/>
            <div style={{ fontSize:11,color:'#475569',fontFamily:"'DM Mono',monospace",marginRight:6 }}>{user?.email}</div>
            <button onClick={signOut} style={{ background:'transparent',border:'1px solid #334155',color:'#64748b',borderRadius:6,padding:'5px 10px',cursor:'pointer',fontSize:11,fontFamily:"'DM Mono',monospace" }}>Sign Out</button>
          </div>
        </div>
      </div>

      <div style={{ padding:'24px',maxWidth:1500,margin:'0 auto' }}>
        {loading?<Spinner/>:(<>

        {/* ═══ DASHBOARD ═══ */}
        {view==='dashboard'&&(<div>
          <div className="sec">Executive Overview</div>
          <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:28 }}>
            {[
              {label:'Gross Sales',val:fmtC(analytics.totalSalesGross),sub:`${fmt(analytics.totalUnits)} units`,color:'#f59e0b'},
              {label:'Net Sales (after CN)',val:fmtC(analytics.totalNetSales),sub:`CN: ${fmtC(analytics.totalCNValue)}`,color:'#38bdf8'},
              {label:'Purchase Cost',val:fmtC(analytics.totalPurchaseCost),sub:`FOC: ${fmtC(analytics.totalFOCCost)}`,color:'#a78bfa'},
              {label:'Net Profit',val:fmtC(analytics.totalProfit),sub:`Margin: ${pct((analytics.totalProfit/analytics.totalNetSales)*100)}`,color:analytics.totalProfit>=0?'#34d399':'#f87171'},
              {label:'Advances Received',val:fmtC(analytics.totalAdvances),sub:'from customers',color:'#34d399'},
              {label:'Pending Collections',val:fmtC(analytics.pendingAdvance),sub:'balance due across all open POs',color:analytics.pendingAdvance>0?'#f87171':'#34d399'},
              {label:'Avg Selling Price',val:fmtC(analytics.avgSellingPrice),sub:`MSA EXW ${fmtC(settings.default_purchase_price_exw)} · DDP ${fmtC(settings.default_purchase_price_ddp)}`,color:'#fb923c'},
              {label:'Open / Pending Orders',val:fmt(analytics.unfulfilled.length),sub:'not yet delivered',color:'#f59e0b'},
            ].map(k=>(
              <div key={k.label} className="kc">
                <div style={{ fontSize:11,color:'#64748b',fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10 }}>{k.label}</div>
                <div style={{ fontFamily:"'DM Mono',monospace",fontSize:26,fontWeight:500,color:k.color,lineHeight:1 }}>{k.val}</div>
                <div style={{ fontSize:11,color:'#475569',marginTop:6 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          <div className="sec">Customer-wise Profitability</div>
          <div style={{ ...card,overflow:'auto',marginBottom:28 }}>
            <table>
              <thead><tr>{['Customer','Units','Gross Sales','CN','FOC','Net Sales','Cost','Profit','Margin','Avg SP','Avg PP','Pending','Alert'].map(h=><th key={h}>{h}</th>)}</tr></thead>
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
                  <td>{c.atRisk?<span style={{ fontSize:11,background:'#450a0a',color:'#f87171',border:'1px solid #7f1d1d',borderRadius:6,padding:'2px 6px',fontFamily:"'DM Mono',monospace" }}>⚠ RISK</span>:<span style={{ fontSize:11,background:'#052e16',color:'#34d399',border:'1px solid #14532d',borderRadius:6,padding:'2px 6px',fontFamily:"'DM Mono',monospace" }}>✓ OK</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {analytics.perCustomer.filter(c=>c.atRisk).map(c=><AlertBox key={c.id} msg={`${c.name} — Avg SP (${fmtC(c.avgSP)}) is below Avg PP (${fmtC(c.avgPP)}). Selling at a loss.`}/>)}
        </div>)}

        {/* ═══ PENDING / UNFULFILLED ORDERS ═══ */}
        {view==='unfulfilled'&&(<div>
          <div className="sec">Pending & Unfulfilled Orders</div>

          {/* Summary cards */}
          <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24 }}>
            {[
              {label:'Open Orders',val:fmt(analytics.unfulfilled.length),color:'#f59e0b'},
              {label:'Total Order Value',val:fmtC(analytics.unfulfilled.reduce((s,p)=>s+p.qty*p.unit_price,0)),color:'#38bdf8'},
              {label:'Total Advances Received',val:fmtC(analytics.unfulfilled.reduce((s,p)=>s+Number(p.advance),0)),color:'#34d399'},
              {label:'Total Balance Pending',val:fmtC(analytics.unfulfilled.reduce((s,p)=>s+Math.max(0,p.qty*p.unit_price-p.advance),0)),color:'#f87171'},
            ].map(k=>(
              <div key={k.label} className="kc">
                <div style={{ fontSize:11,color:'#64748b',fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10 }}>{k.label}</div>
                <div style={{ fontFamily:"'DM Mono',monospace",fontSize:24,fontWeight:500,color:k.color }}>{k.val}</div>
              </div>
            ))}
          </div>

          {/* Stage legend */}
          <div style={{ display:'flex',gap:10,marginBottom:20,flexWrap:'wrap' }}>
            {PO_STAGES.map(s=>{ const c=stageColor(s); return (
              <div key={s} style={{ background:c.bg,border:`1px solid ${c.border}`,color:c.color,fontSize:11,padding:'4px 12px',borderRadius:20,fontFamily:"'DM Mono',monospace" }}>{s}</div>
            );})}
          </div>

          <div style={{ ...card,overflow:'auto' }}>
            <table>
              <thead><tr>{['PO No','Customer','Qty','Order Value','Advance Rcvd','Balance Due','Stage','Progress','Invoice No','Invoice Date','Dispatch Date','Update Stage'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{analytics.unfulfilled.length===0
                ?<tr><td colSpan={12} style={{ textAlign:'center',color:'#475569',padding:32 }}>✓ All orders delivered</td></tr>
                :analytics.unfulfilled.map(p=>{
                  const cust=customers.find(c=>c.id===p.customer_id);
                  const val=p.qty*p.unit_price;
                  const bal=Math.max(0,val-p.advance);
                  return (<tr key={p.id}>
                    <td style={{ fontFamily:"'DM Mono',monospace",color:'#f59e0b' }}>{p.id}</td>
                    <td style={{ fontWeight:500 }}>{cust?.name||'—'}</td>
                    <td style={{ fontFamily:"'DM Mono',monospace" }}>{p.qty}</td>
                    <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(val)}</td>
                    <td style={{ fontFamily:"'DM Mono',monospace",color:'#34d399' }}>{fmtC(p.advance)}</td>
                    <td style={{ fontFamily:"'DM Mono',monospace",color:bal>0?'#f87171':'#34d399',fontWeight:600 }}>{fmtC(bal)}</td>
                    <td><StatusBadge s={p.status}/></td>
                    <td><StagePipeline current={p.status}/></td>
                    <td>
                      <input style={{ ...inp,width:130,fontSize:11,padding:'4px 8px' }} placeholder="INV-001"
                        defaultValue={p.invoice_no||''}
                        onBlur={e=>{ if(e.target.value!==p.invoice_no) updatePOField(p.id,'invoice_no',e.target.value); }}/>
                    </td>
                    <td>
                      <input style={{ ...inp,width:130,fontSize:11,padding:'4px 8px' }} type="date"
                        defaultValue={p.invoice_date||''}
                        onBlur={e=>{ if(e.target.value!==p.invoice_date) updatePOField(p.id,'invoice_date',e.target.value); }}/>
                    </td>
                    <td>
                      <input style={{ ...inp,width:130,fontSize:11,padding:'4px 8px' }} type="date"
                        defaultValue={p.dispatch_date||''}
                        onBlur={e=>{ if(e.target.value!==p.dispatch_date) updatePOField(p.id,'dispatch_date',e.target.value); }}/>
                    </td>
                    <td>
                      <select style={{ ...inp,width:'auto',fontSize:11,padding:'4px 8px' }} value={p.status} onChange={e=>updatePOStatus(p.id,e.target.value)}>
                        {PO_STAGES.map(s=><option key={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>);
                })
              }</tbody>
            </table>
          </div>
        </div>)}

        {/* ═══ PURCHASE ORDERS ═══ */}
        {view==='pos'&&(<div>
          <div className="sec">All Purchase Orders</div>
          <div style={{ ...card,padding:20,marginBottom:24 }}>
            <div style={{ fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:14 }}>+ NEW PURCHASE ORDER</div>
            <div style={{ ...g4,marginBottom:14 }}>
              <div><label style={lbl}>Customer *</label>
                <select style={inp} value={poForm.customer_id} onChange={e=>setPoForm({...poForm,customer_id:e.target.value})}>
                  <option value="">Select…</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Delivery Type *</label>
                <select style={inp} value={poForm.delivery_type} onChange={e=>handleDeliveryChange(e.target.value)}>
                  <option value="DDP">DDP</option><option value="EXW">EXW</option>
                </select>
              </div>
              <div><label style={lbl}>Qty *</label><input style={inp} type="number" placeholder="10" value={poForm.qty} onChange={e=>setPoForm({...poForm,qty:e.target.value})}/></div>
              <div><label style={lbl}>Unit Selling Price (₹) *</label><input style={inp} type="number" placeholder="470000" value={poForm.unit_price} onChange={e=>setPoForm({...poForm,unit_price:e.target.value})}/></div>
            </div>
            <div style={{ background:'#0a0e1a',border:'1px solid #334155',borderRadius:10,padding:14,marginBottom:14 }}>
              <div style={{ fontSize:11,color:'#6366f1',fontFamily:"'DM Mono',monospace",marginBottom:12 }}>PURCHASE / VENDOR DETAILS</div>
              <div style={{ ...g4 }}>
                <div><label style={lbl}>Vendor Name</label>
                  <input style={{ ...inp,borderColor:poForm.vendor_name!=='Primary Manufacturer'?'#6366f1':'#334155' }} type="text" value={poForm.vendor_name} onChange={e=>setPoForm({...poForm,vendor_name:e.target.value})}/>
                </div>
                <div><label style={lbl}>Purchase Price / Unit (₹) *</label>
                  <input style={{ ...inp,borderColor:Number(poForm.purchase_price)!==(poForm.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw)&&poForm.purchase_price?'#6366f1':'#334155' }}
                    type="number" placeholder={`Default: ${fmtC(poForm.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw)}`}
                    value={poForm.purchase_price} onChange={e=>setPoForm({...poForm,purchase_price:e.target.value})}/>
                  {Number(poForm.purchase_price)!==(poForm.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw)&&poForm.purchase_price&&<div style={{ fontSize:11,color:'#6366f1',marginTop:3 }}>⚡ Non-MSA price</div>}
                </div>
                <div><label style={lbl}>Vendor Invoice No.</label><input style={inp} type="text" placeholder="INV-2024-001" value={poForm.vendor_invoice_no} onChange={e=>setPoForm({...poForm,vendor_invoice_no:e.target.value})}/></div>
                <div><label style={lbl}>Purchase Date</label><input style={inp} type="date" value={poForm.purchase_date} onChange={e=>setPoForm({...poForm,purchase_date:e.target.value})}/></div>
              </div>
            </div>
            <div style={{ ...g4 }}>
              <div><label style={lbl}>Advance Received (₹) *</label><input style={inp} type="number" placeholder="100% advance" value={poForm.advance} onChange={e=>setPoForm({...poForm,advance:e.target.value})}/></div>
              <div><label style={lbl}>PO Date *</label><input style={inp} type="date" value={poForm.po_date} onChange={e=>setPoForm({...poForm,po_date:e.target.value})}/></div>
              <div><label style={lbl}>Initial Status</label>
                <select style={inp} value={poForm.status} onChange={e=>setPoForm({...poForm,status:e.target.value})}>
                  {PO_STAGES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display:'flex',alignItems:'flex-end' }}>
                <button onClick={addPO} disabled={saving} style={{ ...btn(saving),width:'100%',padding:'11px 0' }}>{saving?'Saving…':'ADD PO →'}</button>
              </div>
            </div>
            {poForm.qty&&poForm.unit_price&&poForm.purchase_price&&(
              <div style={{ marginTop:12,background:'#0a0e1a',borderRadius:8,padding:'10px 16px',fontSize:12,color:'#94a3b8',fontFamily:"'DM Mono',monospace",display:'flex',gap:24,flexWrap:'wrap' }}>
                <span>Invoice: <strong style={{ color:'#f1f5f9' }}>{fmtC(poForm.qty*poForm.unit_price)}</strong></span>
                <span>Cost: <strong style={{ color:'#f1f5f9' }}>{fmtC(poForm.qty*poForm.purchase_price)}</strong></span>
                <span>Gross Profit: <strong style={{ color:(poForm.qty*poForm.unit_price-poForm.qty*poForm.purchase_price)>=0?'#34d399':'#f87171' }}>{fmtC(poForm.qty*poForm.unit_price-poForm.qty*poForm.purchase_price)}</strong></span>
                <span>Margin: <strong style={{ color:(poForm.qty*poForm.unit_price-poForm.qty*poForm.purchase_price)>=0?'#34d399':'#f87171' }}>{pct(((poForm.qty*poForm.unit_price-poForm.qty*poForm.purchase_price)/(poForm.qty*poForm.unit_price))*100)}</strong></span>
              </div>
            )}
          </div>

          <div style={{ ...card,overflow:'auto' }}>
            <table>
              <thead><tr>{['PO No','Customer','Type','Vendor','Purch. Price','Qty','Sell Price','Gross Value','Advance','Balance','Date','Stage','Update'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{pos.map(p=>{
                const cust=customers.find(c=>c.id===p.customer_id);
                const gross=p.qty*p.unit_price, bal=Math.max(0,gross-p.advance);
                const isAlt=p.vendor_name&&p.vendor_name!=='Primary Manufacturer';
                return (<tr key={p.id}>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#f59e0b' }}>{p.id}</td>
                  <td style={{ fontWeight:500 }}>{cust?.name||'—'}</td>
                  <td><span style={{ fontFamily:"'DM Mono',monospace",fontSize:11,background:p.delivery_type==='DDP'?'#1e3a5f':'#1e3a2f',color:p.delivery_type==='DDP'?'#38bdf8':'#34d399',borderRadius:4,padding:'2px 6px' }}>{p.delivery_type}</span></td>
                  <td><div>{p.vendor_name||'Primary Mfr'}</div>{isAlt&&<div style={{ fontSize:10,color:'#6366f1' }}>⚡ ALT</div>}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:isAlt?'#6366f1':'#94a3b8' }}>{fmtC(p.purchase_price)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{p.qty}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(p.unit_price)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(gross)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#34d399' }}>{fmtC(p.advance)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:bal>0?'#f87171':'#34d399' }}>{fmtC(bal)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:12 }}>{p.po_date}</td>
                  <td><StatusBadge s={p.status}/></td>
                  <td><select style={{ ...inp,width:'auto',fontSize:11,padding:'4px 8px' }} value={p.status} onChange={e=>updatePOStatus(p.id,e.target.value)}>
                    {PO_STAGES.map(s=><option key={s}>{s}</option>)}
                  </select></td>
                </tr>);
              })}</tbody>
            </table>
          </div>
        </div>)}

        {/* ═══ CREDIT NOTES ═══ */}
        {view==='cns'&&(<div>
          <div className="sec">Credit Notes & FOC (to Customers)</div>
          <div style={{ ...card,padding:20,marginBottom:24 }}>
            <div style={{ fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:14 }}>+ NEW CN / FOC</div>
            <div style={{ ...g4 }}>
              <div><label style={lbl}>Linked PO *</label>
                <select style={inp} value={cnForm.po_id} onChange={e=>setCnForm({...cnForm,po_id:e.target.value})}>
                  <option value="">Select PO…</option>{pos.map(p=>{ const c=customers.find(x=>x.id===p.customer_id); return <option key={p.id} value={p.id}>{p.id} — {c?.name}</option>; })}
                </select>
              </div>
              <div><label style={lbl}>Type *</label>
                <select style={inp} value={cnForm.type} onChange={e=>setCnForm({...cnForm,type:e.target.value})}>
                  <option value="CNNote">Credit Note (Volume Discount)</option>
                  <option value="FOC">FOC Units (Free of Cost)</option>
                </select>
              </div>
              {cnForm.type==='CNNote'&&<div><label style={lbl}>CN Amount (₹)</label><input style={inp} type="number" value={cnForm.amount} onChange={e=>setCnForm({...cnForm,amount:e.target.value})}/></div>}
              {cnForm.type==='FOC'&&<div><label style={lbl}>FOC Units</label><input style={inp} type="number" value={cnForm.foc_units} onChange={e=>setCnForm({...cnForm,foc_units:e.target.value})}/></div>}
              <div><label style={lbl}>Date *</label><input style={inp} type="date" value={cnForm.cn_date} onChange={e=>setCnForm({...cnForm,cn_date:e.target.value})}/></div>
              <div><label style={lbl}>Remarks</label><input style={inp} type="text" value={cnForm.note} onChange={e=>setCnForm({...cnForm,note:e.target.value})}/></div>
              <div style={{ display:'flex',alignItems:'flex-end' }}><button onClick={addCN} disabled={saving} style={{ ...btn(saving),width:'100%',padding:'11px 0' }}>{saving?'Saving…':'ADD →'}</button></div>
            </div>
          </div>
          <div style={{ ...card,overflow:'hidden' }}>
            <table>
              <thead><tr>{['ID','PO','Customer','Type','CN Amount','FOC Units','FOC Cost','Date','Remarks'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{cns.map(c=>{ const cust=customers.find(x=>x.id===c.customer_id); const po=pos.find(p=>p.id===c.po_id); const fc=c.type==='FOC'?c.foc_units*Number(po?.purchase_price||0):0; return (
                <tr key={c.id}>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#f59e0b' }}>{c.id}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{c.po_id}</td>
                  <td>{cust?.name||'—'}</td>
                  <td><span style={{ fontFamily:"'DM Mono',monospace",fontSize:11,background:c.type==='CNNote'?'#2d1f3d':'#1f2d1f',color:c.type==='CNNote'?'#c084fc':'#4ade80',borderRadius:4,padding:'2px 6px' }}>{c.type==='CNNote'?'Credit Note':'FOC'}</span></td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#f87171' }}>{c.type==='CNNote'?fmtC(c.amount):'—'}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#e879f9' }}>{c.type==='FOC'?c.foc_units:'—'}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#f87171' }}>{c.type==='FOC'?fmtC(fc):'—'}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#64748b' }}>{c.cn_date}</td>
                  <td style={{ color:'#94a3b8',fontSize:12 }}>{c.note}</td>
                </tr>
              );})}</tbody>
            </table>
          </div>
        </div>)}

        {/* ═══ CUSTOMERS ═══ */}
        {view==='customers'&&(<div>
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
              <thead><tr>{['#','Name','GSTIN','POs','Net Sales','Profit','Margin','Pending','Status'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{customers.map((c,i)=>{ const a=analytics.perCustomer.find(x=>x.id===c.id); return (
                <tr key={c.id}>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#64748b' }}>{i+1}</td>
                  <td style={{ fontWeight:500,color:'#f1f5f9' }}>{c.name}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:12 }}>{c.gstin||'—'}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{pos.filter(p=>p.customer_id===c.id).length}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(a?.netSales||0)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:(a?.profit||0)>=0?'#34d399':'#f87171' }}>{fmtC(a?.profit||0)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace" }}>{pct(a?.margin||0)}</td>
                  <td style={{ fontFamily:"'DM Mono',monospace",color:(a?.pending||0)>0?'#f87171':'#34d399' }}>{fmtC(a?.pending||0)}</td>
                  <td>{a?.atRisk?<span style={{ fontSize:11,background:'#450a0a',color:'#f87171',border:'1px solid #7f1d1d',borderRadius:6,padding:'2px 8px',fontFamily:"'DM Mono',monospace" }}>⚠ AT RISK</span>:<span style={{ fontSize:11,background:'#052e16',color:'#34d399',border:'1px solid #14532d',borderRadius:6,padding:'2px 8px',fontFamily:"'DM Mono',monospace" }}>✓ HEALTHY</span>}</td>
                </tr>
              );})}</tbody>
            </table>
          </div>
        </div>)}

        {/* ═══ SIMULATOR ═══ */}
        {view==='simulator'&&(<div>
          <div className="sec">Discount Simulator — Combined Profitability Analysis</div>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:20 }}>
            {/* Left — existing customer + extra discount */}
            <div style={{ ...card,padding:20 }}>
              <div style={{ fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:14 }}>STEP 1 — SELECT CUSTOMER & EXISTING DISCOUNTS</div>
              <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
                <div><label style={lbl}>Customer</label>
                  <select style={inp} value={sim.customerId} onChange={e=>setSim({...sim,customerId:e.target.value})}>
                    <option value="">Select…</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
                  <div><label style={lbl}>Extra CN on existing POs (₹)</label><input style={inp} type="number" placeholder="0" value={sim.extraCN} onChange={e=>setSim({...sim,extraCN:e.target.value})}/></div>
                  <div><label style={lbl}>Extra FOC on existing POs</label><input style={inp} type="number" placeholder="0" value={sim.extraFOC} onChange={e=>setSim({...sim,extraFOC:e.target.value})}/></div>
                </div>
              </div>
            </div>

            {/* Right — new PO scenario */}
            <div style={{ ...card,padding:20 }}>
              <div style={{ fontSize:12,color:'#38bdf8',fontFamily:"'DM Mono',monospace",marginBottom:14 }}>STEP 2 — NEW PO SCENARIO (OPTIONAL)</div>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
                <div><label style={lbl}>New PO Qty</label><input style={inp} type="number" placeholder="0" value={sim.newPoQty} onChange={e=>setSim({...sim,newPoQty:e.target.value})}/></div>
                <div><label style={lbl}>New PO Unit Sell Price (₹)</label><input style={inp} type="number" placeholder="0" value={sim.newPoUnitPrice} onChange={e=>setSim({...sim,newPoUnitPrice:e.target.value})}/></div>
                <div><label style={lbl}>New PO Purchase Price (₹)</label><input style={inp} type="number" placeholder={fmtC(settings.default_purchase_price_ddp)} value={sim.newPoPurchasePrice} onChange={e=>setSim({...sim,newPoPurchasePrice:e.target.value})}/></div>
                <div><label style={lbl}>CN on new PO (₹)</label><input style={inp} type="number" placeholder="0" value={sim.newPoCNAmount} onChange={e=>setSim({...sim,newPoCNAmount:e.target.value})}/></div>
                <div><label style={lbl}>FOC on new PO (units)</label><input style={inp} type="number" placeholder="0" value={sim.newPoFOCUnits} onChange={e=>setSim({...sim,newPoFOCUnits:e.target.value})}/></div>
              </div>
            </div>
          </div>

          {simResult&&(<div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16 }}>
            {/* Current position */}
            <div style={{ ...card,padding:20 }}>
              <div style={{ fontSize:11,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:14,textTransform:'uppercase' }}>Current — {simResult.cust.name}</div>
              {[['Net Sales',fmtC(simResult.cust.netSales),'#38bdf8'],['Purchase Cost',fmtC(simResult.cust.purchCost),'#94a3b8'],['Net Profit',fmtC(simResult.cust.profit),simResult.cust.profit>=0?'#34d399':'#f87171'],['Margin',pct(simResult.cust.margin),simResult.cust.margin>=0?'#34d399':'#f87171'],['Avg Sell Price',fmtC(simResult.cust.avgSP),'#f59e0b'],['Avg Buy Price',fmtC(simResult.cust.avgPP),'#94a3b8'],['Total Qty',simResult.cust.totalQty,'#e2e8f0']].map(([l,v,c])=>(
                <div key={l} style={{ display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #1e293b' }}>
                  <span style={{ fontSize:12,color:'#64748b' }}>{l}</span>
                  <span style={{ fontFamily:"'DM Mono',monospace",fontSize:12,color:c }}>{v}</span>
                </div>
              ))}
            </div>

            {/* New PO standalone */}
            {simResult.hasNewPO&&(<div style={{ ...card,padding:20 }}>
              <div style={{ fontSize:11,color:'#38bdf8',fontFamily:"'DM Mono',monospace",marginBottom:14,textTransform:'uppercase' }}>New PO (Standalone)</div>
              {[['Qty',simResult.newQty,'#e2e8f0'],['Sell Price',fmtC(simResult.newUnitPrice),'#f59e0b'],['Revenue',fmtC(simResult.newQty*simResult.newUnitPrice),'#38bdf8'],['CN Discount',`- ${fmtC(simResult.newCNAmount)}`,'#f87171'],['FOC Units',simResult.newFOCUnits,'#e879f9'],['Purchase Cost',fmtC(simResult.newQty*simResult.newPurchPrice),'#94a3b8'],['Gross Profit',fmtC(simResult.newPOGrossProfit),simResult.newPOGrossProfit>=0?'#34d399':'#f87171']].map(([l,v,c])=>(
                <div key={l} style={{ display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #1e293b' }}>
                  <span style={{ fontSize:12,color:'#64748b' }}>{l}</span>
                  <span style={{ fontFamily:"'DM Mono',monospace",fontSize:12,color:c }}>{v}</span>
                </div>
              ))}
            </div>)}

            {/* Combined verdict */}
            <div style={{ ...card,border:`1px solid ${simResult.willLoss?'#7f1d1d':'#14532d'}`,padding:20 }}>
              <div style={{ fontSize:11,color:simResult.willLoss?'#f87171':'#34d399',fontFamily:"'DM Mono',monospace",marginBottom:14,textTransform:'uppercase' }}>
                {simResult.willLoss?'⚠ COMBINED — LOSS TERRITORY':'✓ COMBINED — PROFITABLE'}
              </div>
              {[['Total Qty',simResult.combinedTotalQty,'#e2e8f0'],['Net Sales',fmtC(simResult.combinedNetSales),'#38bdf8'],['Total Cost',fmtC(simResult.combinedPurchCost),'#94a3b8'],['Net Profit',fmtC(simResult.combinedProfit),simResult.combinedProfit>=0?'#34d399':'#f87171'],['Margin',pct(simResult.combinedMargin),simResult.combinedMargin>=0?'#34d399':'#f87171'],['Avg Sell Price',fmtC(simResult.combinedAvgSP),'#f59e0b'],['Avg Buy Price',fmtC(simResult.combinedAvgPP),'#94a3b8']].map(([l,v,c])=>(
                <div key={l} style={{ display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #1e293b20' }}>
                  <span style={{ fontSize:12,color:'#64748b' }}>{l}</span>
                  <span style={{ fontFamily:"'DM Mono',monospace",fontSize:12,color:c }}>{v}</span>
                </div>
              ))}
              <div style={{ marginTop:14 }}>
                {simResult.willLoss
                  ?<AlertBox msg="COMBINED profitability turns negative. Avg sell price falls below avg buy price across all orders."/>
                  :<div style={{ background:'#052e16',border:'1px solid #14532d',color:'#34d399',borderRadius:8,padding:'10px 12px',fontSize:12,fontFamily:"'DM Mono',monospace" }}>✓ Safe — combined position remains profitable.</div>}
              </div>
            </div>
          </div>)}
          {!simResult&&<div style={{ color:'#475569',fontSize:13,marginTop:8 }}>← Select a customer in Step 1 to begin.</div>}
        </div>)}

        {/* ═══ MANUFACTURER CNs ═══ */}
        {view==='mfrcn'&&(<div>
          <div className="sec">Manufacturer Credit Notes — Expense Tracker</div>

          {/* Summary */}
          <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24 }}>
            {(()=>{
              const totalCN=mfrCNAnalytics.reduce((s,c)=>s+Number(c.total_value),0);
              const totalUsed=mfrCNAnalytics.reduce((s,c)=>s+c.totalUsed,0);
              const totalBal=mfrCNAnalytics.reduce((s,c)=>s+c.balance,0);
              return [
                {label:'Total Manufacturer CNs',val:fmtC(totalCN),color:'#34d399'},
                {label:'Total Expenses Booked',val:fmtC(totalUsed),color:'#f87171'},
                {label:'Available Balance',val:fmtC(totalBal),color:totalBal>=0?'#f59e0b':'#f87171'},
                {label:'No. of CNs',val:mfrCNs.length,color:'#94a3b8'},
              ];
            })().map(k=>(
              <div key={k.label} className="kc">
                <div style={{ fontSize:11,color:'#64748b',fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10 }}>{k.label}</div>
                <div style={{ fontFamily:"'DM Mono',monospace",fontSize:24,fontWeight:500,color:k.color }}>{k.val}</div>
              </div>
            ))}
          </div>

          {/* Add CN form */}
          <div style={{ ...card,padding:20,marginBottom:24 }}>
            <div style={{ fontSize:12,color:'#34d399',fontFamily:"'DM Mono',monospace",marginBottom:14 }}>+ NEW MANUFACTURER CREDIT NOTE</div>
            <div style={{ ...g4 }}>
              <div><label style={lbl}>CN Reference No. *</label><input style={inp} type="text" placeholder="MFR-CN-2024-001" value={mfrCNForm.cn_ref} onChange={e=>setMfrCNForm({...mfrCNForm,cn_ref:e.target.value})}/></div>
              <div><label style={lbl}>CN Date *</label><input style={inp} type="date" value={mfrCNForm.cn_date} onChange={e=>setMfrCNForm({...mfrCNForm,cn_date:e.target.value})}/></div>
              <div><label style={lbl}>Total CN Value (₹) *</label><input style={inp} type="number" placeholder="e.g. 500000" value={mfrCNForm.total_value} onChange={e=>setMfrCNForm({...mfrCNForm,total_value:e.target.value})}/></div>
              <div><label style={lbl}>Description</label><input style={inp} type="text" placeholder="e.g. Q1 Marketing Support" value={mfrCNForm.description} onChange={e=>setMfrCNForm({...mfrCNForm,description:e.target.value})}/></div>
            </div>
            <div style={{ marginTop:14 }}>
              <button onClick={addMfrCN} disabled={saving} style={btn(saving)}>{saving?'Saving…':'ADD MANUFACTURER CN →'}</button>
            </div>
          </div>

          {/* Add Expense form */}
          <div style={{ ...card,padding:20,marginBottom:24 }}>
            <div style={{ fontSize:12,color:'#f87171',fontFamily:"'DM Mono',monospace",marginBottom:14 }}>+ BOOK EXPENSE AGAINST MANUFACTURER CN</div>
            <div style={{ ...g4,marginBottom:14 }}>
              <div><label style={lbl}>Manufacturer CN *</label>
                <select style={inp} value={expForm.mfr_cn_id} onChange={e=>setExpForm({...expForm,mfr_cn_id:e.target.value})}>
                  <option value="">Select CN…</option>
                  {mfrCNAnalytics.map(c=><option key={c.id} value={c.id}>{c.cn_ref} — Bal: {fmtC(c.balance)}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Expense Name *</label><input style={inp} type="text" placeholder="e.g. Marketing Event" value={expForm.expense_name} onChange={e=>setExpForm({...expForm,expense_name:e.target.value})}/></div>
              <div><label style={lbl}>Expense Date *</label><input style={inp} type="date" value={expForm.expense_date} onChange={e=>setExpForm({...expForm,expense_date:e.target.value})}/></div>
              <div><label style={lbl}>Amount (excl. GST) (₹) *</label><input style={inp} type="number" placeholder="0" value={expForm.amount} onChange={e=>setExpForm({...expForm,amount:e.target.value})}/></div>
              <div><label style={lbl}>GST Rate (%)</label>
                <select style={inp} value={expForm.gst_rate} onChange={e=>setExpForm({...expForm,gst_rate:e.target.value})}>
                  {GST_RATES.map(r=><option key={r} value={r}>{r}%</option>)}
                </select>
              </div>
              <div><label style={lbl}>Vendor / Payee</label><input style={inp} type="text" placeholder="e.g. Event Co." value={expForm.vendor_name} onChange={e=>setExpForm({...expForm,vendor_name:e.target.value})}/></div>
              <div><label style={lbl}>Invoice / Bill Ref.</label><input style={inp} type="text" placeholder="INV-001" value={expForm.invoice_ref} onChange={e=>setExpForm({...expForm,invoice_ref:e.target.value})}/></div>
              <div><label style={lbl}>Notes</label><input style={inp} type="text" value={expForm.notes} onChange={e=>setExpForm({...expForm,notes:e.target.value})}/></div>
            </div>
            {expForm.amount&&(
              <div style={{ marginBottom:14,background:'#0a0e1a',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#94a3b8',fontFamily:"'DM Mono',monospace",display:'flex',gap:20 }}>
                <span>Base: <strong style={{ color:'#f1f5f9' }}>{fmtC(expForm.amount)}</strong></span>
                <span>GST ({expForm.gst_rate}%): <strong style={{ color:'#f87171' }}>{fmtC(expForm.amount*expForm.gst_rate/100)}</strong></span>
                <span>Total: <strong style={{ color:'#f59e0b' }}>{fmtC(Number(expForm.amount)*(1+Number(expForm.gst_rate)/100))}</strong></span>
              </div>
            )}
            <button onClick={addExpense} disabled={saving} style={{ ...btn(saving),background:'#dc2626',color:'#fff' }}>{saving?'Saving…':'BOOK EXPENSE →'}</button>
          </div>

          {/* CN list with expandable expenses */}
          <div className="sec">All Manufacturer CNs</div>
          {mfrCNAnalytics.map(cn=>(
            <div key={cn.id} style={{ ...card,marginBottom:16,overflow:'hidden' }}>
              {/* CN header row */}
              <div style={{ display:'flex',alignItems:'center',gap:16,padding:'14px 20px',cursor:'pointer',borderBottom:expandedMfrCN===cn.id?'1px solid #1e293b':'none' }} onClick={()=>setExpandedMfrCN(expandedMfrCN===cn.id?null:cn.id)}>
                <div style={{ fontFamily:"'DM Mono',monospace",color:'#34d399',fontSize:14,fontWeight:500 }}>{cn.cn_ref}</div>
                <div style={{ fontSize:12,color:'#64748b' }}>{cn.cn_date}</div>
                {cn.description&&<div style={{ fontSize:12,color:'#94a3b8' }}>{cn.description}</div>}
                <div style={{ marginLeft:'auto',display:'flex',gap:24,alignItems:'center' }}>
                  <div style={{ textAlign:'right' }}><div style={{ fontSize:11,color:'#64748b' }}>Total CN</div><div style={{ fontFamily:"'DM Mono',monospace",color:'#34d399' }}>{fmtC(cn.total_value)}</div></div>
                  <div style={{ textAlign:'right' }}><div style={{ fontSize:11,color:'#64748b' }}>Used</div><div style={{ fontFamily:"'DM Mono',monospace",color:'#f87171' }}>{fmtC(cn.totalUsed)}</div></div>
                  <div style={{ textAlign:'right' }}><div style={{ fontSize:11,color:'#64748b' }}>Balance</div><div style={{ fontFamily:"'DM Mono',monospace",color:cn.balance>=0?'#f59e0b':'#f87171',fontWeight:600,fontSize:16 }}>{fmtC(cn.balance)}</div></div>
                  {/* Balance bar */}
                  <div style={{ width:100 }}>
                    <div style={{ height:6,background:'#1e293b',borderRadius:3,overflow:'hidden' }}>
                      <div style={{ height:'100%',width:`${Math.min(100,(cn.totalUsed/cn.total_value)*100)}%`,background:cn.balance<0?'#f87171':'#f59e0b',borderRadius:3,transition:'width 0.5s' }}/>
                    </div>
                    <div style={{ fontSize:10,color:'#475569',marginTop:3,fontFamily:"'DM Mono',monospace" }}>{Math.min(100,((cn.totalUsed/cn.total_value)*100)).toFixed(1)}% used</div>
                  </div>
                  <div style={{ color:'#475569',fontSize:14 }}>{expandedMfrCN===cn.id?'▲':'▼'}</div>
                </div>
              </div>
              {/* Expanded expenses */}
              {expandedMfrCN===cn.id&&(
                <div>
                  {cn.expenses.length===0
                    ?<div style={{ padding:'16px 20px',color:'#475569',fontSize:13 }}>No expenses booked against this CN yet.</div>
                    :<table>
                      <thead><tr>{['Expense','Date','Base Amount','GST Rate','GST Amount','Total','Vendor','Invoice Ref','Notes'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                      <tbody>{cn.expenses.map(e=>(
                        <tr key={e.id}>
                          <td style={{ fontWeight:500 }}>{e.expense_name}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace",color:'#64748b' }}>{e.expense_date}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(e.amount)}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace",color:'#94a3b8' }}>{e.gst_rate}%</td>
                          <td style={{ fontFamily:"'DM Mono',monospace",color:'#f87171' }}>{fmtC(e.gst_amount)}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace",color:'#f87171',fontWeight:600 }}>{fmtC(e.total_amount)}</td>
                          <td style={{ color:'#94a3b8' }}>{e.vendor_name||'—'}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:12 }}>{e.invoice_ref||'—'}</td>
                          <td style={{ color:'#94a3b8',fontSize:12 }}>{e.notes||'—'}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  }
                </div>
              )}
            </div>
          ))}
        </div>)}

        {/* ═══ SETTINGS ═══ */}
        {view==='settings'&&(<div style={{ maxWidth:620 }}>
          <div className="sec">Settings — MSA Default Purchase Prices</div>
          <div style={{ ...card,padding:28,marginBottom:20 }}>
            <div style={{ fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:6 }}>DEFAULT PURCHASE PRICES (MASTER SUPPLY AGREEMENT)</div>
            <div style={{ fontSize:13,color:'#64748b',marginBottom:24,lineHeight:1.7 }}>Update at the start of each financial year. Existing POs are not affected.</div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:24 }}>
              <div>
                <label style={lbl}>EXW Default (₹)</label>
                <input style={inp} type="number" value={settingsForm.exw} onChange={e=>setSettingsForm({...settingsForm,exw:e.target.value})}/>
                <div style={{ fontSize:11,color:'#475569',marginTop:4 }}>Active: {fmtC(settings.default_purchase_price_exw)}</div>
              </div>
              <div>
                <label style={lbl}>DDP Default (₹)</label>
                <input style={inp} type="number" value={settingsForm.ddp} onChange={e=>setSettingsForm({...settingsForm,ddp:e.target.value})}/>
                <div style={{ fontSize:11,color:'#475569',marginTop:4 }}>Active: {fmtC(settings.default_purchase_price_ddp)}</div>
              </div>
            </div>
            <button onClick={saveSettings} disabled={saving} style={btn(saving)}>{saving?'Saving…':'SAVE →'}</button>
          </div>
        </div>)}

        </>)}
      </div>
    </div>
  );
}
