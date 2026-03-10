import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt  = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);
const fmtC = n => '₹' + fmt(n);
const pct  = n => isFinite(n) && !isNaN(n) ? n.toFixed(1) + '%' : '—';
const fmtL = n => { if (!n) return '₹0'; if (Math.abs(n) >= 1e7) return '₹' + (n/1e7).toFixed(2) + 'Cr'; if (Math.abs(n) >= 1e5) return '₹' + (n/1e5).toFixed(1) + 'L'; return fmtC(n); };

const PO_STAGES = ['PO Received','Advance Received','Invoice Raised','Shipment Dispatched','Delivered / Fulfilled'];
const GST_RATES = [0,5,12,18,28];
const MONTHS    = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];
const FY_MONTHS = (fy) => {
  const yr = parseInt(fy.split('-')[0].replace('FY ',''));
  return [
    {label:'Apr', start:`${yr}-04-01`, end:`${yr}-04-30`},
    {label:'May', start:`${yr}-05-01`, end:`${yr}-05-31`},
    {label:'Jun', start:`${yr}-06-01`, end:`${yr}-06-30`},
    {label:'Jul', start:`${yr}-07-01`, end:`${yr}-07-31`},
    {label:'Aug', start:`${yr}-08-01`, end:`${yr}-08-31`},
    {label:'Sep', start:`${yr}-09-01`, end:`${yr}-09-30`},
    {label:'Oct', start:`${yr}-10-01`, end:`${yr}-10-31`},
    {label:'Nov', start:`${yr}-11-01`, end:`${yr}-11-30`},
    {label:'Dec', start:`${yr}-12-01`, end:`${yr}-12-31`},
    {label:'Jan', start:`${yr+1}-01-01`, end:`${yr+1}-01-31`},
    {label:'Feb', start:`${yr+1}-02-01`, end:`${yr+1}-02-28`},
    {label:'Mar', start:`${yr+1}-03-01`, end:`${yr+1}-03-31`},
  ];
};

const stageColor = s => ({ 'PO Received':{bg:'#1e1a3f',color:'#a78bfa',border:'#4c1d95'},'Advance Received':{bg:'#1a2e3f',color:'#38bdf8',border:'#0c4a6e'},'Invoice Raised':{bg:'#1f2d1f',color:'#4ade80',border:'#14532d'},'Shipment Dispatched':{bg:'#451a03',color:'#fb923c',border:'#7c2d12'},'Delivered / Fulfilled':{bg:'#052e16',color:'#34d399',border:'#14532d'} }[s] || {bg:'#1e293b',color:'#94a3b8',border:'#334155'});

const StatusBadge = ({s}) => { const c=stageColor(s); return <span style={{background:c.bg,color:c.color,border:`1px solid ${c.border}`,fontSize:11,padding:'2px 8px',borderRadius:6,fontFamily:"'DM Mono',monospace",whiteSpace:'nowrap'}}>{s}</span>; };
const AlertBox = ({msg}) => <div style={{display:'flex',alignItems:'center',gap:8,background:'#450a0a',border:'1px solid #7f1d1d',color:'#f87171',borderRadius:8,padding:'10px 14px',fontSize:12,fontFamily:"'DM Mono',monospace"}}><span style={{fontSize:16}}>⚠</span>{msg}</div>;
const Spinner = () => <div style={{textAlign:'center',padding:40,color:'#475569',fontFamily:"'DM Mono',monospace",fontSize:13}}>Loading…</div>;

const StagePipeline = ({current}) => {
  const idx = PO_STAGES.indexOf(current);
  return <div style={{display:'flex',alignItems:'center',gap:0}}>{PO_STAGES.map((s,i)=><div key={s} style={{display:'flex',alignItems:'center'}}><div style={{width:10,height:10,borderRadius:'50%',background:i<=idx?'#34d399':'#1e293b',border:i===idx?'2px solid #34d399':'1px solid #334155'}} title={s}/>{i<PO_STAGES.length-1&&<div style={{width:14,height:2,background:i<idx?'#34d399':'#1e293b'}}/>}</div>)}</div>;
};

// Mini bar chart
const BarChart = ({data, valueKey, labelKey, color='#f59e0b', height=80}) => {
  const max = Math.max(...data.map(d=>d[valueKey]||0), 1);
  return (
    <div style={{display:'flex',alignItems:'flex-end',gap:4,height}}>
      {data.map((d,i)=>(
        <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
          <div style={{width:'100%',background:color,borderRadius:'3px 3px 0 0',height:`${((d[valueKey]||0)/max)*height*0.85}px`,minHeight:d[valueKey]?2:0,transition:'height 0.5s'}}/>
          <div style={{fontSize:9,color:'#475569',fontFamily:"'DM Mono',monospace",transform:'rotate(-30deg)',transformOrigin:'top center',marginTop:4}}>{d[labelKey]}</div>
        </div>
      ))}
    </div>
  );
};

// Progress ring
const Ring = ({value, max, color, size=80, label}) => {
  const r=28, circ=2*Math.PI*r, progress=Math.min(1,value/max), dash=progress*circ;
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
      <svg width={size} height={size} viewBox="0 0 70 70">
        <circle cx="35" cy="35" r={r} fill="none" stroke="#1e293b" strokeWidth="8"/>
        <circle cx="35" cy="35" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 35 35)" style={{transition:'stroke-dasharray 1s'}}/>
        <text x="35" y="35" textAnchor="middle" dy="0.35em" fill={color} fontSize="11" fontFamily="'DM Mono',monospace">{Math.round(progress*100)}%</text>
      </svg>
      {label&&<div style={{fontSize:11,color:'#64748b',fontFamily:"'DM Mono',monospace",textAlign:'center'}}>{label}</div>}
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
  const [targets,setTargets]     = useState([]);
  const [pipeline,setPipeline]   = useState([]);
  const [cashTxns,setCashTxns]   = useState([]);
  const [settings,setSettings]   = useState({default_purchase_price_exw:400000,default_purchase_price_ddp:403000});
  const [loading,setLoading]     = useState(true);
  const [saving,setSaving]       = useState(false);
  const [toast,setToast]         = useState('');
  const [expandedMfrCN,setExpandedMfrCN] = useState(null);
  const [selectedFY,setSelectedFY] = useState('FY 2024-25');

  // Forms
  const [poForm,setPoForm]       = useState({customer_id:'',delivery_type:'DDP',qty:'',unit_price:'',purchase_price:'',vendor_name:'Primary Manufacturer',vendor_invoice_no:'',purchase_date:'',advance:'',po_date:'',status:'PO Received',invoice_no:'',invoice_date:'',dispatch_date:''});
  const [cnForm,setCnForm]       = useState({po_id:'',type:'CNNote',amount:'',foc_units:'',cn_date:'',note:''});
  const [custForm,setCustForm]   = useState({name:'',gstin:''});
  const [sim,setSim]             = useState({customerId:'',extraCN:'',extraFOC:'',newPoQty:'',newPoUnitPrice:'',newPoPurchasePrice:'',newPoCNAmount:'',newPoFOCUnits:''});
  const [settingsForm,setSettingsForm] = useState({exw:'',ddp:''});
  const [mfrCNForm,setMfrCNForm] = useState({cn_ref:'',cn_date:'',total_value:'',description:''});
  const [expForm,setExpForm]     = useState({mfr_cn_id:'',expense_name:'',expense_date:'',amount:'',gst_rate:'18',vendor_name:'',invoice_ref:'',notes:''});
  const [pipeForm,setPipeForm]   = useState({customer_id:'',expected_qty:'',expected_value:'',expected_date:'',delivery_type:'DDP',probability:'75',notes:'',status:'Active'});
  const [cashForm,setCashForm]   = useState({txn_date:'',txn_type:'Cash In',category:'Balance Receipt',amount:'',reference_po:'',description:''});
  const [targetForm,setTargetForm] = useState({fy_label:'',fy_start:'',fy_end:'',target_units:'',target_value:'',target_profit:'',mfr_slab_1_units:'',mfr_slab_1_bonus:'',mfr_slab_2_units:'',mfr_slab_2_bonus:'',notes:''});

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3500); };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [r1,r2,r3,r4,r5,r6,r7,r8,r9] = await Promise.all([
      supabase.from('customers').select('*').order('id'),
      supabase.from('purchase_orders').select('*').order('created_at'),
      supabase.from('credit_notes').select('*').order('created_at'),
      supabase.from('settings').select('*'),
      supabase.from('manufacturer_cns').select('*').order('cn_date',{ascending:false}),
      supabase.from('manufacturer_cn_expenses').select('*').order('expense_date',{ascending:false}),
      supabase.from('annual_targets').select('*').order('fy_start',{ascending:false}),
      supabase.from('pipeline_orders').select('*').order('expected_date'),
      supabase.from('cash_transactions').select('*').order('txn_date',{ascending:false}),
    ]);
    setCustomers(r1.data||[]);
    setPos(r2.data||[]);
    setCns(r3.data||[]);
    setMfrCNs(r5.data||[]);
    setMfrExp(r6.data||[]);
    setTargets(r7.data||[]);
    setPipeline(r8.data||[]);
    setCashTxns(r9.data||[]);
    if (r4.data) {
      const p={}; r4.data.forEach(r=>{ p[r.key]=Number(r.value); });
      setSettings(p);
      setSettingsForm({exw:p.default_purchase_price_exw,ddp:p.default_purchase_price_ddp});
    }
    setLoading(false);
  },[]);

  useEffect(()=>{ fetchAll(); },[fetchAll]);

  const handleDeliveryChange = type => {
    const def=type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw;
    setPoForm(f=>({...f,delivery_type:type,purchase_price:f.vendor_name==='Primary Manufacturer'?def:f.purchase_price}));
  };

  // ── CRUD helpers ──────────────────────────────────────────────────────────
  const addCustomer = async () => {
    if (!custForm.name) return;
    setSaving(true);
    const {error}=await supabase.from('customers').insert([custForm]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Customer added ✓'); setCustForm({name:'',gstin:''}); await fetchAll(); }
    setSaving(false);
  };

  const addPO = async () => {
    if (!poForm.customer_id||!poForm.qty||!poForm.unit_price||!poForm.purchase_price||!poForm.advance||!poForm.po_date) { showToast('Fill all required fields'); return; }
    setSaving(true);
    const {data:idData}=await supabase.rpc('next_po_id');
    const {error}=await supabase.from('purchase_orders').insert([{id:idData,customer_id:Number(poForm.customer_id),delivery_type:poForm.delivery_type,qty:Number(poForm.qty),unit_price:Number(poForm.unit_price),purchase_price:Number(poForm.purchase_price),vendor_name:poForm.vendor_name||'Primary Manufacturer',vendor_invoice_no:poForm.vendor_invoice_no,purchase_date:poForm.purchase_date||null,advance:Number(poForm.advance),po_date:poForm.po_date,status:poForm.status,invoice_no:poForm.invoice_no||null,invoice_date:poForm.invoice_date||null,dispatch_date:poForm.dispatch_date||null}]);
    if (error) showToast('Error: '+error.message);
    else { showToast('PO added ✓'); setPoForm({customer_id:'',delivery_type:'DDP',qty:'',unit_price:'',purchase_price:settings.default_purchase_price_ddp,vendor_name:'Primary Manufacturer',vendor_invoice_no:'',purchase_date:'',advance:'',po_date:'',status:'PO Received',invoice_no:'',invoice_date:'',dispatch_date:''}); await fetchAll(); }
    setSaving(false);
  };

  const updatePOStatus = async (id,s) => { await supabase.from('purchase_orders').update({status:s}).eq('id',id); await fetchAll(); };
  const updatePOField  = async (id,f,v) => { await supabase.from('purchase_orders').update({[f]:v||null}).eq('id',id); await fetchAll(); };

  const addCN = async () => {
    if (!cnForm.po_id||!cnForm.cn_date) { showToast('Fill required fields'); return; }
    const po=pos.find(p=>p.id===cnForm.po_id); if (!po) return;
    setSaving(true);
    const {data:idData}=await supabase.rpc('next_cn_id');
    const {error}=await supabase.from('credit_notes').insert([{id:idData,po_id:cnForm.po_id,customer_id:po.customer_id,type:cnForm.type,amount:Number(cnForm.amount||0),foc_units:Number(cnForm.foc_units||0),cn_date:cnForm.cn_date,note:cnForm.note}]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Added ✓'); setCnForm({po_id:'',type:'CNNote',amount:'',foc_units:'',cn_date:'',note:''}); await fetchAll(); }
    setSaving(false);
  };

  const addMfrCN = async () => {
    if (!mfrCNForm.cn_ref||!mfrCNForm.cn_date||!mfrCNForm.total_value) { showToast('Fill required fields'); return; }
    setSaving(true);
    const {error}=await supabase.from('manufacturer_cns').insert([{cn_ref:mfrCNForm.cn_ref,cn_date:mfrCNForm.cn_date,total_value:Number(mfrCNForm.total_value),description:mfrCNForm.description}]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Mfr CN added ✓'); setMfrCNForm({cn_ref:'',cn_date:'',total_value:'',description:''}); await fetchAll(); }
    setSaving(false);
  };

  const addExpense = async () => {
    if (!expForm.mfr_cn_id||!expForm.expense_name||!expForm.expense_date||!expForm.amount) { showToast('Fill required fields'); return; }
    setSaving(true);
    const amt=Number(expForm.amount), gst=Number(expForm.gst_rate||0);
    const gstAmt=parseFloat((amt*gst/100).toFixed(2)), total=parseFloat((amt+gstAmt).toFixed(2));
    const {error}=await supabase.from('manufacturer_cn_expenses').insert([{mfr_cn_id:Number(expForm.mfr_cn_id),expense_name:expForm.expense_name,expense_date:expForm.expense_date,amount:amt,gst_rate:gst,gst_amount:gstAmt,total_amount:total,vendor_name:expForm.vendor_name,invoice_ref:expForm.invoice_ref,notes:expForm.notes}]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Expense booked ✓'); setExpForm({mfr_cn_id:expForm.mfr_cn_id,expense_name:'',expense_date:'',amount:'',gst_rate:'18',vendor_name:'',invoice_ref:'',notes:''}); await fetchAll(); }
    setSaving(false);
  };

  const addPipeline = async () => {
    if (!pipeForm.customer_id||!pipeForm.expected_qty||!pipeForm.expected_date) { showToast('Fill required fields'); return; }
    setSaving(true);
    const {error}=await supabase.from('pipeline_orders').insert([{customer_id:Number(pipeForm.customer_id),expected_qty:Number(pipeForm.expected_qty),expected_value:Number(pipeForm.expected_value||0),expected_date:pipeForm.expected_date,delivery_type:pipeForm.delivery_type,probability:Number(pipeForm.probability||50),notes:pipeForm.notes,status:pipeForm.status}]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Pipeline entry added ✓'); setPipeForm({customer_id:'',expected_qty:'',expected_value:'',expected_date:'',delivery_type:'DDP',probability:'75',notes:'',status:'Active'}); await fetchAll(); }
    setSaving(false);
  };

  const updatePipelineStatus = async (id,s) => { await supabase.from('pipeline_orders').update({status:s}).eq('id',id); await fetchAll(); };

  const addCashTxn = async () => {
    if (!cashForm.txn_date||!cashForm.amount||!cashForm.category) { showToast('Fill required fields'); return; }
    setSaving(true);
    const {error}=await supabase.from('cash_transactions').insert([{txn_date:cashForm.txn_date,txn_type:cashForm.txn_type,category:cashForm.category,amount:Number(cashForm.amount),reference_po:cashForm.reference_po||null,description:cashForm.description}]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Transaction added ✓'); setCashForm({txn_date:'',txn_type:'Cash In',category:'Balance Receipt',amount:'',reference_po:'',description:''}); await fetchAll(); }
    setSaving(false);
  };

  const saveSettings = async () => {
    if (!settingsForm.exw||!settingsForm.ddp) return;
    setSaving(true);
    const {error}=await supabase.from('settings').upsert([
      {key:'default_purchase_price_exw',value:String(settingsForm.exw),label:'EXW',updated_at:new Date().toISOString()},
      {key:'default_purchase_price_ddp',value:String(settingsForm.ddp),label:'DDP',updated_at:new Date().toISOString()},
    ],{onConflict:'key'});
    if (error) showToast('Error: '+error.message);
    else { showToast('Saved ✓'); await fetchAll(); }
    setSaving(false);
  };

  const saveTarget = async () => {
    if (!targetForm.fy_label||!targetForm.fy_start||!targetForm.fy_end||!targetForm.target_units||!targetForm.target_value) { showToast('Fill required fields'); return; }
    setSaving(true);
    const {error}=await supabase.from('annual_targets').upsert([{fy_label:targetForm.fy_label,fy_start:targetForm.fy_start,fy_end:targetForm.fy_end,target_units:Number(targetForm.target_units),target_value:Number(targetForm.target_value),target_profit:Number(targetForm.target_profit||0),mfr_slab_1_units:Number(targetForm.mfr_slab_1_units||0),mfr_slab_1_bonus:Number(targetForm.mfr_slab_1_bonus||0),mfr_slab_2_units:Number(targetForm.mfr_slab_2_units||0),mfr_slab_2_bonus:Number(targetForm.mfr_slab_2_bonus||0),notes:targetForm.notes}],{onConflict:'fy_label'});
    if (error) showToast('Error: '+error.message);
    else { showToast('Target saved ✓'); await fetchAll(); }
    setSaving(false);
  };

  // ── Core analytics ────────────────────────────────────────────────────────
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
      return {...cust,grossSales,totalQty,cnVal,focUnits,focCost,netSales,purchCost,profit,avgSP,avgPP,margin,advance,pending,atRisk};
    });

    return {totalSalesGross,totalUnits,totalAdvances,totalCNValue,totalFOCUnits,totalFOCCost,totalNetSales,totalPurchaseCost,totalProfit,pendingAdvance,avgSellingPrice,perCustomer,unfulfilled};
  },[customers,pos,cns]);

  // ── Cash Flow analytics ────────────────────────────────────────────────────
  const cashAnalytics = useMemo(()=>{
    const fy = targets.find(t=>t.fy_label===selectedFY) || targets[0];
    if (!fy) return null;
    const fyMonths = FY_MONTHS(fy.fy_label);

    const monthlyData = fyMonths.map(m=>{
      // Advances received in this month (from POs)
      const advancesIn = pos.filter(p=>p.po_date>=m.start&&p.po_date<=m.end).reduce((s,p)=>s+Number(p.advance),0);
      // Cash transactions in this month
      const txnIn  = cashTxns.filter(t=>t.txn_date>=m.start&&t.txn_date<=m.end&&t.txn_type==='Cash In').reduce((s,t)=>s+Number(t.amount),0);
      const txnOut = cashTxns.filter(t=>t.txn_date>=m.start&&t.txn_date<=m.end&&t.txn_type==='Cash Out').reduce((s,t)=>s+Number(t.amount),0);
      // Manufacturer payments (purchase cost of POs placed that month)
      const mfrPayments = pos.filter(p=>p.purchase_date>=m.start&&p.purchase_date<=m.end).reduce((s,p)=>s+p.qty*Number(p.purchase_price),0);
      // Expenses booked
      const expenses = mfrExp.filter(e=>e.expense_date>=m.start&&e.expense_date<=m.end).reduce((s,e)=>s+Number(e.total_amount),0);
      const totalIn  = advancesIn+txnIn;
      const totalOut = mfrPayments+txnOut+expenses;
      const net      = totalIn-totalOut;
      return {label:m.label, cashIn:totalIn, cashOut:totalOut, net, advancesIn, txnIn, mfrPayments, txnOut, expenses};
    });

    const totalCashIn   = monthlyData.reduce((s,m)=>s+m.cashIn,0);
    const totalCashOut  = monthlyData.reduce((s,m)=>s+m.cashOut,0);
    const netCashFlow   = totalCashIn-totalCashOut;

    // Expected inflows (pending balances on open POs)
    const expectedInflows = pos.filter(p=>p.status!=='Delivered / Fulfilled').reduce((s,p)=>s+Math.max(0,p.qty*p.unit_price-p.advance),0);

    // 30/60/90 day forecast from pipeline
    const today = new Date();
    const d30 = new Date(today); d30.setDate(d30.getDate()+30);
    const d60 = new Date(today); d60.setDate(d60.getDate()+60);
    const d90 = new Date(today); d90.setDate(d90.getDate()+90);
    const forecast30 = pipeline.filter(p=>p.status==='Active'&&new Date(p.expected_date)<=d30).reduce((s,p)=>s+(p.expected_value||p.expected_qty*(p.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw))*p.probability/100,0);
    const forecast60 = pipeline.filter(p=>p.status==='Active'&&new Date(p.expected_date)<=d60).reduce((s,p)=>s+(p.expected_value||p.expected_qty*(p.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw))*p.probability/100,0);
    const forecast90 = pipeline.filter(p=>p.status==='Active'&&new Date(p.expected_date)<=d90).reduce((s,p)=>s+(p.expected_value||p.expected_qty*(p.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw))*p.probability/100,0);

    return {monthlyData,totalCashIn,totalCashOut,netCashFlow,expectedInflows,forecast30,forecast60,forecast90,fy};
  },[pos,cashTxns,mfrExp,pipeline,targets,selectedFY,settings]);

  // ── Target vs Actual ──────────────────────────────────────────────────────
  const targetAnalytics = useMemo(()=>{
    const fy = targets.find(t=>t.fy_label===selectedFY) || targets[0];
    if (!fy) return null;
    const fyMonths = FY_MONTHS(fy.fy_label);
    const fyPos = pos.filter(p=>p.po_date>=fy.fy_start&&p.po_date<=fy.fy_end);
    const fyCNs = cns.filter(c=>{ const po=pos.find(p=>p.id===c.po_id); return po&&po.po_date>=fy.fy_start&&po.po_date<=fy.fy_end; });

    const actualUnits = fyPos.reduce((s,p)=>s+p.qty,0);
    const actualGross = fyPos.reduce((s,p)=>s+p.qty*p.unit_price,0);
    const actualCN    = fyCNs.filter(c=>c.type==='CNNote').reduce((s,c)=>s+Number(c.amount),0);
    const actualFOCCost=fyCNs.filter(c=>c.type==='FOC').reduce((s,c)=>{ const po=pos.find(p=>p.id===c.po_id); return s+c.foc_units*Number(po?.purchase_price||0); },0);
    const actualNet   = actualGross-actualCN;
    const actualCost  = fyPos.reduce((s,p)=>s+p.qty*Number(p.purchase_price),0)+actualFOCCost;
    const actualProfit= actualNet-actualCost;

    // Monthly breakdown
    const monthly = fyMonths.map(m=>{
      const mPos=fyPos.filter(p=>p.po_date>=m.start&&p.po_date<=m.end);
      const units=mPos.reduce((s,p)=>s+p.qty,0);
      const value=mPos.reduce((s,p)=>s+p.qty*p.unit_price,0);
      return {label:m.label,units,value};
    });

    // Run rate projection
    const monthsElapsed = monthly.filter(m=>m.units>0).length || 1;
    const runRateUnits  = (actualUnits/monthsElapsed)*12;
    const runRateValue  = (actualNet/monthsElapsed)*12;

    // Slab analysis
    const slab1Hit = fy.mfr_slab_1_units>0 && actualUnits>=fy.mfr_slab_1_units;
    const slab2Hit = fy.mfr_slab_2_units>0 && actualUnits>=fy.mfr_slab_2_units;
    const unitsToSlab1 = Math.max(0,fy.mfr_slab_1_units-actualUnits);
    const unitsToSlab2 = Math.max(0,fy.mfr_slab_2_units-actualUnits);

    return {fy,actualUnits,actualGross,actualNet,actualCost,actualProfit,monthly,runRateUnits,runRateValue,slab1Hit,slab2Hit,unitsToSlab1,unitsToSlab2};
  },[targets,pos,cns,selectedFY]);

  // ── GST analytics ─────────────────────────────────────────────────────────
  const gstAnalytics = useMemo(()=>{
    const fy = targets.find(t=>t.fy_label===selectedFY) || targets[0];
    if (!fy) return null;
    const fyMonths = FY_MONTHS(fy.fy_label);
    const GST_RATE_SALES = 0.12; // Solar inverters — 12% GST (adjust if needed)

    const monthly = fyMonths.map(m=>{
      const mPos = pos.filter(p=>p.po_date>=m.start&&p.po_date<=m.end);
      const outputGSTBase = mPos.reduce((s,p)=>s+p.qty*p.unit_price,0);
      const outputGST = outputGSTBase*GST_RATE_SALES;
      const inputGSTBase = mPos.reduce((s,p)=>s+p.qty*Number(p.purchase_price),0);
      const inputGSTPurchase = inputGSTBase*GST_RATE_SALES;
      const inputGSTExpenses = mfrExp.filter(e=>e.expense_date>=m.start&&e.expense_date<=m.end).reduce((s,e)=>s+Number(e.gst_amount),0);
      const totalInput = inputGSTPurchase+inputGSTExpenses;
      const netGST = outputGST-totalInput;
      return {label:m.label,outputGST,inputGSTPurchase,inputGSTExpenses,totalInput,netGST};
    });

    const totalOutput  = monthly.reduce((s,m)=>s+m.outputGST,0);
    const totalInput   = monthly.reduce((s,m)=>s+m.totalInput,0);
    const totalNet     = totalOutput-totalInput;
    return {monthly,totalOutput,totalInput,totalNet,gstRatePct:(GST_RATE_SALES*100)+'%'};
  },[pos,mfrExp,targets,selectedFY]);

  // ── Receivables aging ────────────────────────────────────────────────────
  const agingAnalytics = useMemo(()=>{
    const today = new Date();
    const openPos = pos.filter(p=>p.status!=='Delivered / Fulfilled');
    const aged = openPos.map(p=>{
      const bal = Math.max(0,p.qty*p.unit_price-p.advance);
      const days = Math.floor((today-new Date(p.po_date))/(1000*86400));
      const bucket = days<=30?'0-30':days<=60?'31-60':days<=90?'61-90':'90+';
      const cust = customers.find(c=>c.id===p.customer_id);
      return {...p,bal,days,bucket,custName:cust?.name||'—'};
    }).filter(p=>p.bal>0);

    const buckets = {'0-30':0,'31-60':0,'61-90':0,'90+':0};
    aged.forEach(p=>{ buckets[p.bucket]=(buckets[p.bucket]||0)+p.bal; });
    const total = aged.reduce((s,p)=>s+p.bal,0);
    return {aged,buckets,total};
  },[pos,customers]);

  // ── Simulator ─────────────────────────────────────────────────────────────
  const simResult = useMemo(()=>{
    if (!sim.customerId) return null;
    const cust=analytics.perCustomer.find(c=>c.id===Number(sim.customerId));
    if (!cust) return null;
    const extraCN=Number(sim.extraCN||0),extraFOC=Number(sim.extraFOC||0);
    const nq=Number(sim.newPoQty||0),nup=Number(sim.newPoUnitPrice||0),npp=Number(sim.newPoPurchasePrice||settings.default_purchase_price_ddp);
    const nCN=Number(sim.newPoCNAmount||0),nFOC=Number(sim.newPoFOCUnits||0);
    const hasNewPO=nq>0&&nup>0;
    const cG=cust.grossSales+(hasNewPO?nq*nup:0);
    const cCV=cust.cnVal+extraCN+nCN;
    const cFC=cust.focCost+extraFOC*settings.default_purchase_price_ddp+nFOC*npp;
    const cPC=cust.purchCost-cust.focCost+(hasNewPO?nq*npp:0)+cFC;
    const cNS=cG-cCV,cP=cNS-cPC,cTQ=cust.totalQty+(hasNewPO?nq:0);
    const cFU=cust.focUnits+extraFOC+nFOC;
    const cASP=cTQ>0?cNS/cTQ:0,cAPP=(cTQ+cFU)>0?cPC/(cTQ+cFU):0;
    const cM=cNS>0?(cP/cNS)*100:0;
    const nPGP=hasNewPO?(nq*nup-nCN)-(nq*npp+nFOC*npp):0;
    return {cust,extraCN,extraFOC,hasNewPO,nq,nup,npp,nCN,nFOC,cG,cCV,cNS,cPC,cP,cASP,cAPP,cM,cTQ,willLoss:cASP<cAPP,nPGP};
  },[sim,analytics,settings]);

  // ── Mfr CN ────────────────────────────────────────────────────────────────
  const mfrCNAnalytics = useMemo(()=>mfrCNs.map(cn=>{
    const expenses=mfrExp.filter(e=>e.mfr_cn_id===cn.id);
    const totalUsed=expenses.reduce((s,e)=>s+Number(e.total_amount),0);
    return {...cn,expenses,totalUsed,balance:Number(cn.total_value)-totalUsed};
  }),[mfrCNs,mfrExp]);

  // ── Pipeline analytics ────────────────────────────────────────────────────
  const pipeAnalytics = useMemo(()=>{
    const active=pipeline.filter(p=>p.status==='Active');
    const totalExpUnits=active.reduce((s,p)=>s+p.expected_qty,0);
    const totalExpValue=active.reduce((s,p)=>s+(p.expected_value||p.expected_qty*settings.default_purchase_price_ddp),0);
    const weightedValue=active.reduce((s,p)=>s+(p.expected_value||p.expected_qty*settings.default_purchase_price_ddp)*p.probability/100,0);
    return {active,totalExpUnits,totalExpValue,weightedValue};
  },[pipeline,settings]);

  // ── Styles ────────────────────────────────────────────────────────────────
  const inp  = {width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:8,padding:'10px 12px',color:'#e2e8f0',fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:'none'};
  const lbl  = {display:'block',fontSize:11,fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.1em',color:'#64748b',marginBottom:5};
  const card = {background:'#0f172a',border:'1px solid #1e293b',borderRadius:16};
  const btn  = (dis,col='#f59e0b',tc='#0a0e1a')=>({background:col,color:tc,fontWeight:700,border:'none',borderRadius:8,padding:'11px 24px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:12,opacity:dis?0.6:1});
  const g4   = {display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14};
  const g3   = {display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14};

  const navItems=[
    {key:'dashboard',label:'📊 Overview'},
    {key:'cashflow', label:'💰 Cash Flow'},
    {key:'target',   label:'🎯 Target vs Actual'},
    {key:'aging',    label:'📅 Aging'},
    {key:'gst',      label:'🧾 GST'},
    {key:'pipeline', label:'📦 Pipeline'},
    {key:'unfulfilled',label:'⏳ Pending'},
    {key:'pos',      label:'📋 Orders'},
    {key:'cns',      label:'🔖 CN/FOC'},
    {key:'customers',label:'👤 Customers'},
    {key:'simulator',label:'🔮 Simulator'},
    {key:'mfrcn',    label:'🏭 Mfr. CNs'},
    {key:'settings', label:'⚙️ Settings'},
  ];

  const FYSelector = () => (
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
      <div style={{fontSize:11,color:'#64748b',fontFamily:"'DM Mono',monospace"}}>FINANCIAL YEAR:</div>
      {targets.map(t=>(
        <button key={t.fy_label} onClick={()=>setSelectedFY(t.fy_label)} style={{background:selectedFY===t.fy_label?'#1e293b':'transparent',border:`1px solid ${selectedFY===t.fy_label?'#f59e0b':'#334155'}`,color:selectedFY===t.fy_label?'#f59e0b':'#64748b',borderRadius:6,padding:'4px 12px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:12}}>
          {t.fy_label}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:'#0a0e1a',minHeight:'100vh',color:'#e2e8f0'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:6px;} ::-webkit-scrollbar-track{background:#0a0e1a;} ::-webkit-scrollbar-thumb{background:#334155;border-radius:3px;}
        .kc{background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid #334155;border-radius:16px;padding:20px;transition:transform .2s,box-shadow .2s;}
        .kc:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,.4);}
        .nb{background:transparent;border:none;cursor:pointer;padding:7px 11px;border-radius:7px;font-size:11px;font-family:'DM Sans',sans-serif;color:#94a3b8;transition:all .15s;white-space:nowrap;}
        .nb.active{background:#1e293b;color:#f59e0b;border:1px solid #334155;}
        .nb:hover:not(.active){background:#1e293b50;color:#e2e8f0;}
        table{width:100%;border-collapse:collapse;}
        th{font-size:11px;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.08em;color:#64748b;padding:9px 12px;text-align:left;border-bottom:1px solid #1e293b;}
        td{font-size:13px;padding:9px 12px;border-bottom:1px solid #1e293b40;vertical-align:middle;}
        tr:hover td{background:#1e293b50;}
        .sec{font-size:11px;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.12em;color:#64748b;margin-bottom:14px;}
        select option{background:#1e293b;}
        input:focus,select:focus{border-color:#f59e0b!important;outline:none;}
      `}</style>

      {toast&&<div style={{position:'fixed',top:20,right:20,background:'#052e16',border:'1px solid #14532d',color:'#34d399',padding:'12px 20px',borderRadius:10,fontFamily:"'DM Mono',monospace",fontSize:13,zIndex:9999,boxShadow:'0 8px 24px rgba(0,0,0,.5)'}}>{toast}</div>}

      {/* Header */}
      <div style={{background:'linear-gradient(90deg,#0f172a,#1e293b)',borderBottom:'1px solid #1e293b',padding:'0 16px'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,height:52}}>
          <div style={{fontSize:18}}>☀️</div>
          <div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'#f59e0b',letterSpacing:'0.1em'}}>SOLAR INVERTER ERP</div>
            <div style={{fontSize:9,color:'#475569',fontFamily:"'DM Mono',monospace"}}>DISTRIBUTOR MANAGEMENT</div>
          </div>
          <div style={{marginLeft:'auto',display:'flex',gap:1,alignItems:'center',flexWrap:'wrap'}}>
            {navItems.map(n=><button key={n.key} className={`nb ${view===n.key?'active':''}`} onClick={()=>setView(n.key)}>{n.label}</button>)}
            <div style={{width:1,height:18,background:'#1e293b',margin:'0 6px'}}/>
            <div style={{fontSize:10,color:'#475569',fontFamily:"'DM Mono',monospace",marginRight:6}}>{user?.email}</div>
            <button onClick={signOut} style={{background:'transparent',border:'1px solid #334155',color:'#64748b',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace"}}>Sign Out</button>
          </div>
        </div>
      </div>

      <div style={{padding:'22px',maxWidth:1600,margin:'0 auto'}}>
        {loading?<Spinner/>:(<>

        {/* ═══════════════ OVERVIEW ═══════════════ */}
        {view==='dashboard'&&(<div>
          <div className="sec">Executive Overview — All Time</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:28}}>
            {[
              {label:'Gross Sales',val:fmtL(analytics.totalSalesGross),sub:`${fmt(analytics.totalUnits)} units`,color:'#f59e0b'},
              {label:'Net Sales',val:fmtL(analytics.totalNetSales),sub:`After CNs: −${fmtL(analytics.totalCNValue)}`,color:'#38bdf8'},
              {label:'Purchase Cost',val:fmtL(analytics.totalPurchaseCost),sub:`FOC: ${fmtL(analytics.totalFOCCost)}`,color:'#a78bfa'},
              {label:'Net Profit',val:fmtL(analytics.totalProfit),sub:`Margin: ${pct((analytics.totalProfit/analytics.totalNetSales)*100)}`,color:analytics.totalProfit>=0?'#34d399':'#f87171'},
              {label:'Advances Received',val:fmtL(analytics.totalAdvances),sub:'from customers',color:'#34d399'},
              {label:'Pending Collections',val:fmtL(analytics.pendingAdvance),sub:'on open orders',color:analytics.pendingAdvance>0?'#f87171':'#34d399'},
              {label:'Avg Selling Price',val:fmtC(analytics.avgSellingPrice),sub:`MSA EXW ${fmtC(settings.default_purchase_price_exw)}`,color:'#fb923c'},
              {label:'Open Orders',val:fmt(analytics.unfulfilled.length),sub:'pending delivery',color:'#f59e0b'},
            ].map(k=>(
              <div key={k.label} className="kc">
                <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>{k.label}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:24,fontWeight:500,color:k.color,lineHeight:1}}>{k.val}</div>
                <div style={{fontSize:11,color:'#475569',marginTop:6}}>{k.sub}</div>
              </div>
            ))}
          </div>
          <div className="sec">Customer Profitability</div>
          <div style={{...card,overflow:'auto',marginBottom:20}}>
            <table>
              <thead><tr>{['Customer','Units','Gross','CN','Net Sales','Cost','Profit','Margin','Avg SP','Avg PP','Pending','Alert'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{analytics.perCustomer.map(c=>(
                <tr key={c.id}>
                  <td style={{fontWeight:500}}>{c.name}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{c.totalQty}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(c.grossSales)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171'}}>{fmtL(c.cnVal)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#38bdf8'}}>{fmtL(c.netSales)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(c.purchCost)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:c.profit>=0?'#34d399':'#f87171',fontWeight:600}}>{fmtL(c.profit)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:c.margin>=0?'#34d399':'#f87171'}}>{pct(c.margin)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtC(c.avgSP)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtC(c.avgPP)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:c.pending>0?'#f87171':'#34d399'}}>{fmtL(c.pending)}</td>
                  <td>{c.atRisk?<span style={{fontSize:10,background:'#450a0a',color:'#f87171',border:'1px solid #7f1d1d',borderRadius:6,padding:'2px 6px',fontFamily:"'DM Mono',monospace"}}>⚠ RISK</span>:<span style={{fontSize:10,background:'#052e16',color:'#34d399',border:'1px solid #14532d',borderRadius:6,padding:'2px 6px',fontFamily:"'DM Mono',monospace"}}>✓ OK</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {analytics.perCustomer.filter(c=>c.atRisk).map(c=><AlertBox key={c.id} msg={`${c.name} — Avg SP (${fmtC(c.avgSP)}) below Avg PP (${fmtC(c.avgPP)})`}/>)}
        </div>)}

        {/* ═══════════════ CASH FLOW ═══════════════ */}
        {view==='cashflow'&&(<div>
          <div className="sec">Cash Flow Dashboard</div>
          <FYSelector/>
          {cashAnalytics?(<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}>
              {[
                {label:'Total Cash In (FY)',val:fmtL(cashAnalytics.totalCashIn),color:'#34d399'},
                {label:'Total Cash Out (FY)',val:fmtL(cashAnalytics.totalCashOut),color:'#f87171'},
                {label:'Net Cash Flow (FY)',val:fmtL(cashAnalytics.netCashFlow),color:cashAnalytics.netCashFlow>=0?'#f59e0b':'#f87171'},
                {label:'Expected Inflows (Open POs)',val:fmtL(cashAnalytics.expectedInflows),color:'#38bdf8'},
              ].map(k=>(
                <div key={k.label} className="kc">
                  <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:8}}>{k.label}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:22,fontWeight:500,color:k.color}}>{k.val}</div>
                </div>
              ))}
            </div>

            {/* Forecast */}
            <div style={{...card,padding:20,marginBottom:20}}>
              <div className="sec">Pipeline Cash Forecast (Probability-Weighted)</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16}}>
                {[['Next 30 Days',cashAnalytics.forecast30,'#34d399'],['Next 60 Days',cashAnalytics.forecast60,'#f59e0b'],['Next 90 Days',cashAnalytics.forecast90,'#38bdf8']].map(([l,v,c])=>(
                  <div key={l} style={{background:'#0a0e1a',borderRadius:10,padding:16,textAlign:'center'}}>
                    <div style={{fontSize:11,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:8}}>{l}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:20,color:c,fontWeight:500}}>{fmtL(v)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Monthly chart */}
            <div style={{...card,padding:20,marginBottom:20}}>
              <div className="sec">Monthly Cash Flow — {selectedFY}</div>
              <div style={{overflowX:'auto'}}>
                <table>
                  <thead><tr>{['Month','Cash In','Cash Out','Net','Advances','Mfr Payments','Expenses'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{cashAnalytics.monthlyData.map(m=>(
                    <tr key={m.label}>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b'}}>{m.label}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{m.cashIn>0?fmtL(m.cashIn):'—'}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171'}}>{m.cashOut>0?fmtL(m.cashOut):'—'}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:m.net>=0?'#34d399':'#f87171',fontWeight:600}}>{m.cashIn>0||m.cashOut>0?fmtL(m.net):'—'}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#94a3b8'}}>{m.advancesIn>0?fmtL(m.advancesIn):'—'}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#94a3b8'}}>{m.mfrPayments>0?fmtL(m.mfrPayments):'—'}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#94a3b8'}}>{m.expenses>0?fmtL(m.expenses):'—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>

            {/* Add cash transaction */}
            <div style={{...card,padding:20}}>
              <div style={{fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:14}}>+ LOG CASH TRANSACTION</div>
              <div style={{...g4,marginBottom:14}}>
                <div><label style={lbl}>Date *</label><input style={inp} type="date" value={cashForm.txn_date} onChange={e=>setCashForm({...cashForm,txn_date:e.target.value})}/></div>
                <div><label style={lbl}>Type *</label>
                  <select style={inp} value={cashForm.txn_type} onChange={e=>setCashForm({...cashForm,txn_type:e.target.value,category:e.target.value==='Cash In'?'Balance Receipt':'Manufacturer Payment'})}>
                    <option>Cash In</option><option>Cash Out</option>
                  </select>
                </div>
                <div><label style={lbl}>Category *</label>
                  <select style={inp} value={cashForm.category} onChange={e=>setCashForm({...cashForm,category:e.target.value})}>
                    {cashForm.txn_type==='Cash In'
                      ?['Balance Receipt','Advance Receipt','Other Income'].map(c=><option key={c}>{c}</option>)
                      :['Manufacturer Payment','Operating Expense','FOC Purchase','Logistics','Other'].map(c=><option key={c}>{c}</option>)
                    }
                  </select>
                </div>
                <div><label style={lbl}>Amount (₹) *</label><input style={inp} type="number" value={cashForm.amount} onChange={e=>setCashForm({...cashForm,amount:e.target.value})}/></div>
                <div><label style={lbl}>Linked PO (optional)</label><input style={inp} type="text" placeholder="PO-001" value={cashForm.reference_po} onChange={e=>setCashForm({...cashForm,reference_po:e.target.value})}/></div>
                <div><label style={lbl}>Description</label><input style={inp} type="text" value={cashForm.description} onChange={e=>setCashForm({...cashForm,description:e.target.value})}/></div>
                <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={addCashTxn} disabled={saving} style={{...btn(saving),width:'100%',padding:'11px 0'}}>{saving?'Saving…':'ADD →'}</button></div>
              </div>
              <div style={{...card,overflow:'hidden',marginTop:10}}>
                <table>
                  <thead><tr>{['Date','Type','Category','Amount','PO Ref','Description'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{cashTxns.slice(0,20).map(t=>(
                    <tr key={t.id}>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b'}}>{t.txn_date}</td>
                      <td><span style={{fontSize:11,background:t.txn_type==='Cash In'?'#052e16':'#450a0a',color:t.txn_type==='Cash In'?'#34d399':'#f87171',border:`1px solid ${t.txn_type==='Cash In'?'#14532d':'#7f1d1d'}`,borderRadius:4,padding:'2px 6px',fontFamily:"'DM Mono',monospace"}}>{t.txn_type}</span></td>
                      <td style={{color:'#94a3b8'}}>{t.category}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:t.txn_type==='Cash In'?'#34d399':'#f87171',fontWeight:600}}>{fmtL(t.amount)}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b'}}>{t.reference_po||'—'}</td>
                      <td style={{color:'#94a3b8',fontSize:12}}>{t.description||'—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </>):<div style={{color:'#475569',fontSize:13}}>No financial year configured. Add one in Settings.</div>}
        </div>)}

        {/* ═══════════════ TARGET vs ACTUAL ═══════════════ */}
        {view==='target'&&(<div>
          <div className="sec">Target vs Actual</div>
          <FYSelector/>
          {targetAnalytics?(<>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:24}}>
              {/* Progress rings */}
              <div style={{...card,padding:24}}>
                <div className="sec">Achievement — {targetAnalytics.fy.fy_label}</div>
                <div style={{display:'flex',gap:24,justifyContent:'space-around',alignItems:'center',padding:'10px 0'}}>
                  <Ring value={targetAnalytics.actualUnits} max={targetAnalytics.fy.target_units||1} color="#f59e0b" label="Units"/>
                  <Ring value={targetAnalytics.actualNet} max={targetAnalytics.fy.target_value||1} color="#38bdf8" label="Revenue"/>
                  <Ring value={targetAnalytics.actualProfit} max={targetAnalytics.fy.target_profit||1} color="#34d399" label="Profit"/>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginTop:16}}>
                  {[
                    ['Target Units',fmt(targetAnalytics.fy.target_units),'Actual: '+fmt(targetAnalytics.actualUnits),'#f59e0b'],
                    ['Target Revenue',fmtL(targetAnalytics.fy.target_value),'Actual: '+fmtL(targetAnalytics.actualNet),'#38bdf8'],
                    ['Target Profit',fmtL(targetAnalytics.fy.target_profit),'Actual: '+fmtL(targetAnalytics.actualProfit),'#34d399'],
                  ].map(([l,t,a,c])=>(
                    <div key={l} style={{background:'#0a0e1a',borderRadius:8,padding:12}}>
                      <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:4}}>{l}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:16,color:c}}>{t}</div>
                      <div style={{fontSize:11,color:'#475569',marginTop:2}}>{a}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Run rate + slabs */}
              <div style={{...card,padding:24}}>
                <div className="sec">Run Rate & Manufacturer Slabs</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                  {[
                    ['Projected Units (Full Year)',fmt(Math.round(targetAnalytics.runRateUnits)),'#f59e0b'],
                    ['Projected Revenue (Full Year)',fmtL(targetAnalytics.runRateValue),'#38bdf8'],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{background:'#0a0e1a',borderRadius:8,padding:12}}>
                      <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:4}}>{l}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:16,color:c}}>{v}</div>
                    </div>
                  ))}
                </div>
                {targetAnalytics.fy.mfr_slab_1_units>0&&(<>
                  <div style={{fontSize:11,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:8}}>MANUFACTURER INCENTIVE SLABS</div>
                  {[
                    [1,targetAnalytics.fy.mfr_slab_1_units,targetAnalytics.fy.mfr_slab_1_bonus,targetAnalytics.slab1Hit,targetAnalytics.unitsToSlab1],
                    [2,targetAnalytics.fy.mfr_slab_2_units,targetAnalytics.fy.mfr_slab_2_bonus,targetAnalytics.slab2Hit,targetAnalytics.unitsToSlab2],
                  ].filter(([,u])=>u>0).map(([i,u,b,hit,rem])=>(
                    <div key={i} style={{background:hit?'#052e16':'#1a1a2e',border:`1px solid ${hit?'#14532d':'#334155'}`,borderRadius:8,padding:12,marginBottom:8}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <div>
                          <div style={{fontSize:12,color:hit?'#34d399':'#94a3b8',fontFamily:"'DM Mono',monospace"}}>Slab {i} — {fmt(u)} units → Bonus {fmtL(b)}</div>
                          <div style={{fontSize:11,color:'#475569',marginTop:2}}>{hit?'✓ ACHIEVED':'Need '+fmt(rem)+' more units'}</div>
                        </div>
                        <div style={{fontSize:20}}>{hit?'🏆':'🎯'}</div>
                      </div>
                      <div style={{height:4,background:'#1e293b',borderRadius:2,marginTop:8,overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${Math.min(100,(targetAnalytics.actualUnits/u)*100)}%`,background:hit?'#34d399':'#f59e0b',borderRadius:2}}/>
                      </div>
                    </div>
                  ))}
                </>)}
              </div>
            </div>

            {/* Monthly trend */}
            <div style={{...card,padding:20,marginBottom:20}}>
              <div className="sec">Monthly Units Sold</div>
              <BarChart data={targetAnalytics.monthly} valueKey="units" labelKey="label" color="#f59e0b" height={100}/>
            </div>

            <div style={{...card,padding:20,marginBottom:20}}>
              <div className="sec">Monthly Revenue</div>
              <BarChart data={targetAnalytics.monthly} valueKey="value" labelKey="label" color="#38bdf8" height={100}/>
            </div>
          </>):<div style={{color:'#475569',fontSize:13}}>No target configured. Set one in Settings → Annual Targets.</div>}
        </div>)}

        {/* ═══════════════ AGING ═══════════════ */}
        {view==='aging'&&(<div>
          <div className="sec">Receivables Aging — Outstanding Balance on Open POs</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:16,marginBottom:24}}>
            <div className="kc">
              <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:8}}>TOTAL OUTSTANDING</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:22,color:'#f87171'}}>{fmtL(agingAnalytics.total)}</div>
            </div>
            {Object.entries(agingAnalytics.buckets).map(([b,v])=>{
              const c=b==='0-30'?'#34d399':b==='31-60'?'#f59e0b':b==='61-90'?'#fb923c':'#f87171';
              return (<div key={b} className="kc">
                <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:8}}>{b} DAYS</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:22,color:c}}>{fmtL(v)}</div>
                <div style={{fontSize:11,color:'#475569',marginTop:4}}>{agingAnalytics.total>0?pct((v/agingAnalytics.total)*100):' — '} of total</div>
              </div>);
            })}
          </div>

          {/* Aging bar */}
          <div style={{...card,padding:20,marginBottom:20}}>
            <div className="sec">Aging Distribution</div>
            <div style={{height:16,borderRadius:8,overflow:'hidden',display:'flex',marginBottom:8}}>
              {Object.entries(agingAnalytics.buckets).map(([b,v])=>{
                const c=b==='0-30'?'#34d399':b==='31-60'?'#f59e0b':b==='61-90'?'#fb923c':'#f87171';
                const w=agingAnalytics.total>0?(v/agingAnalytics.total)*100:0;
                return w>0?<div key={b} style={{width:`${w}%`,background:c,transition:'width 0.5s'}}/>:null;
              })}
            </div>
            <div style={{display:'flex',gap:16,fontSize:11,fontFamily:"'DM Mono',monospace"}}>
              {[['0-30','#34d399'],['31-60','#f59e0b'],['61-90','#fb923c'],['90+','#f87171']].map(([b,c])=>(
                <div key={b} style={{display:'flex',alignItems:'center',gap:4}}><div style={{width:8,height:8,borderRadius:'50%',background:c}}/><span style={{color:'#64748b'}}>{b} days</span></div>
              ))}
            </div>
          </div>

          <div style={{...card,overflow:'auto'}}>
            <table>
              <thead><tr>{['PO No','Customer','PO Date','Days Outstanding','Order Value','Advance','Balance Due','Stage','Bucket'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{agingAnalytics.aged.length===0
                ?<tr><td colSpan={9} style={{textAlign:'center',color:'#475569',padding:24}}>No outstanding balances</td></tr>
                :agingAnalytics.aged.sort((a,b)=>b.days-a.days).map(p=>{
                  const bc=p.bucket==='0-30'?'#34d399':p.bucket==='31-60'?'#f59e0b':p.bucket==='61-90'?'#fb923c':'#f87171';
                  return (<tr key={p.id}>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b'}}>{p.id}</td>
                    <td style={{fontWeight:500}}>{p.custName}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b'}}>{p.po_date}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:bc,fontWeight:600}}>{p.days} days</td>
                    <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(p.qty*p.unit_price)}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{fmtL(p.advance)}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:bc,fontWeight:600}}>{fmtL(p.bal)}</td>
                    <td><StatusBadge s={p.status}/></td>
                    <td><span style={{fontSize:11,background:'#1e293b',color:bc,border:`1px solid ${bc}`,borderRadius:4,padding:'2px 6px',fontFamily:"'DM Mono',monospace"}}>{p.bucket} days</span></td>
                  </tr>);
                })
              }</tbody>
            </table>
          </div>
        </div>)}

        {/* ═══════════════ GST ═══════════════ */}
        {view==='gst'&&(<div>
          <div className="sec">GST Summary</div>
          <FYSelector/>
          {gstAnalytics?(<>
            <div style={{background:'#1a1a2e',border:'1px solid #334155',borderRadius:10,padding:'10px 16px',marginBottom:20,fontSize:12,color:'#64748b',fontFamily:"'DM Mono',monospace"}}>
              ⚠ GST rate used: <strong style={{color:'#f59e0b'}}>{gstAnalytics.gstRatePct}</strong> on sales and purchases. Verify this matches your actual GST rate for solar inverters. Update in code if different.
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16,marginBottom:24}}>
              {[
                {label:'Total Output GST (Collected)',val:fmtL(gstAnalytics.totalOutput),sub:'GST charged to customers',color:'#f87171'},
                {label:'Total Input GST (Credit)',val:fmtL(gstAnalytics.totalInput),sub:'GST paid on purchases+expenses',color:'#34d399'},
                {label:'Net GST Payable',val:fmtL(gstAnalytics.totalNet),sub:gstAnalytics.totalNet>=0?'Payable to Government':'Credit with Government',color:gstAnalytics.totalNet>=0?'#f59e0b':'#34d399'},
              ].map(k=>(
                <div key={k.label} className="kc">
                  <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",textTransform:'uppercase',marginBottom:8}}>{k.label}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:22,color:k.color}}>{k.val}</div>
                  <div style={{fontSize:11,color:'#475569',marginTop:4}}>{k.sub}</div>
                </div>
              ))}
            </div>
            <div style={{...card,overflow:'auto'}}>
              <table>
                <thead><tr>{['Month','Output GST','Input (Purchase)','Input (Expenses)','Total Input Credit','Net Payable'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>{gstAnalytics.monthly.map(m=>(
                  <tr key={m.label}>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b'}}>{m.label}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171'}}>{m.outputGST>0?fmtL(m.outputGST):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{m.inputGSTPurchase>0?fmtL(m.inputGSTPurchase):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{m.inputGSTExpenses>0?fmtL(m.inputGSTExpenses):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{m.totalInput>0?fmtL(m.totalInput):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:m.netGST>=0?'#f59e0b':'#34d399',fontWeight:600}}>{m.outputGST>0||m.totalInput>0?fmtL(m.netGST):'—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>):<div style={{color:'#475569',fontSize:13}}>Configure a financial year in Settings first.</div>}
        </div>)}

        {/* ═══════════════ PIPELINE ═══════════════ */}
        {view==='pipeline'&&(<div>
          <div className="sec">Forward Order Pipeline</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}>
            {[
              {label:'Active Pipeline (Units)',val:fmt(pipeAnalytics.totalExpUnits),color:'#f59e0b'},
              {label:'Expected Value',val:fmtL(pipeAnalytics.totalExpValue),color:'#38bdf8'},
              {label:'Probability-Weighted Value',val:fmtL(pipeAnalytics.weightedValue),color:'#34d399'},
              {label:'Active Opportunities',val:pipeAnalytics.active.length,color:'#a78bfa'},
            ].map(k=>(
              <div key={k.label} className="kc">
                <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",textTransform:'uppercase',marginBottom:8}}>{k.label}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:22,color:k.color}}>{k.val}</div>
              </div>
            ))}
          </div>

          <div style={{...card,padding:20,marginBottom:24}}>
            <div style={{fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:14}}>+ ADD PIPELINE OPPORTUNITY</div>
            <div style={{...g4,marginBottom:14}}>
              <div><label style={lbl}>Customer *</label>
                <select style={inp} value={pipeForm.customer_id} onChange={e=>setPipeForm({...pipeForm,customer_id:e.target.value})}>
                  <option value="">Select…</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Expected Qty *</label><input style={inp} type="number" placeholder="10" value={pipeForm.expected_qty} onChange={e=>setPipeForm({...pipeForm,expected_qty:e.target.value})}/></div>
              <div><label style={lbl}>Expected Value (₹)</label><input style={inp} type="number" placeholder="Auto from qty×price" value={pipeForm.expected_value} onChange={e=>setPipeForm({...pipeForm,expected_value:e.target.value})}/></div>
              <div><label style={lbl}>Expected Date *</label><input style={inp} type="date" value={pipeForm.expected_date} onChange={e=>setPipeForm({...pipeForm,expected_date:e.target.value})}/></div>
              <div><label style={lbl}>Delivery Type</label>
                <select style={inp} value={pipeForm.delivery_type} onChange={e=>setPipeForm({...pipeForm,delivery_type:e.target.value})}>
                  <option value="DDP">DDP</option><option value="EXW">EXW</option>
                </select>
              </div>
              <div><label style={lbl}>Probability (%)</label>
                <select style={inp} value={pipeForm.probability} onChange={e=>setPipeForm({...pipeForm,probability:e.target.value})}>
                  {[25,50,75,90,100].map(p=><option key={p} value={p}>{p}%</option>)}
                </select>
              </div>
              <div><label style={lbl}>Notes</label><input style={inp} type="text" placeholder="Customer discussion notes" value={pipeForm.notes} onChange={e=>setPipeForm({...pipeForm,notes:e.target.value})}/></div>
              <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={addPipeline} disabled={saving} style={{...btn(saving),width:'100%',padding:'11px 0'}}>{saving?'Saving…':'ADD →'}</button></div>
            </div>
          </div>

          <div style={{...card,overflow:'auto'}}>
            <table>
              <thead><tr>{['Customer','Qty','Expected Value','Probability','Weighted Value','Expected Date','Delivery','Status','Notes','Update'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{pipeline.map(p=>{
                const cust=customers.find(c=>c.id===p.customer_id);
                const val=p.expected_value||p.expected_qty*(p.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw);
                const weighted=(val*p.probability/100);
                const sc={Active:'#38bdf8',Won:'#34d399',Lost:'#f87171',Deferred:'#f59e0b'};
                return (<tr key={p.id}>
                  <td style={{fontWeight:500}}>{cust?.name||'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{p.expected_qty}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(val)}</td>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{flex:1,height:4,background:'#1e293b',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',width:`${p.probability}%`,background:'#38bdf8',borderRadius:2}}/></div>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'#38bdf8'}}>{p.probability}%</span>
                    </div>
                  </td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{fmtL(weighted)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b'}}>{p.expected_date}</td>
                  <td><span style={{fontSize:11,background:p.delivery_type==='DDP'?'#1e3a5f':'#1e3a2f',color:p.delivery_type==='DDP'?'#38bdf8':'#34d399',borderRadius:4,padding:'2px 6px',fontFamily:"'DM Mono',monospace"}}>{p.delivery_type}</span></td>
                  <td><span style={{fontSize:11,color:sc[p.status]||'#94a3b8',fontFamily:"'DM Mono',monospace"}}>{p.status}</span></td>
                  <td style={{color:'#94a3b8',fontSize:12,maxWidth:150}}>{p.notes}</td>
                  <td>
                    <select style={{...inp,width:'auto',fontSize:11,padding:'4px 8px'}} value={p.status} onChange={e=>updatePipelineStatus(p.id,e.target.value)}>
                      {['Active','Won','Lost','Deferred'].map(s=><option key={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>);
              })}</tbody>
            </table>
          </div>
        </div>)}

        {/* ═══════════════ PENDING ORDERS ═══════════════ */}
        {view==='unfulfilled'&&(<div>
          <div className="sec">Pending & Unfulfilled Orders</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}>
            {[
              {label:'Open Orders',val:fmt(analytics.unfulfilled.length),color:'#f59e0b'},
              {label:'Total Order Value',val:fmtL(analytics.unfulfilled.reduce((s,p)=>s+p.qty*p.unit_price,0)),color:'#38bdf8'},
              {label:'Advances Received',val:fmtL(analytics.unfulfilled.reduce((s,p)=>s+Number(p.advance),0)),color:'#34d399'},
              {label:'Balance Pending',val:fmtL(analytics.unfulfilled.reduce((s,p)=>s+Math.max(0,p.qty*p.unit_price-p.advance),0)),color:'#f87171'},
            ].map(k=>(
              <div key={k.label} className="kc">
                <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",textTransform:'uppercase',marginBottom:8}}>{k.label}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:22,color:k.color}}>{k.val}</div>
              </div>
            ))}
          </div>
          <div style={{...card,overflow:'auto'}}>
            <table>
              <thead><tr>{['PO No','Customer','Qty','Order Value','Advance','Balance','Stage','Progress','Invoice No','Invoice Date','Dispatch Date','Update'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{analytics.unfulfilled.length===0
                ?<tr><td colSpan={12} style={{textAlign:'center',color:'#475569',padding:32}}>✓ All orders delivered</td></tr>
                :analytics.unfulfilled.map(p=>{
                  const cust=customers.find(c=>c.id===p.customer_id);
                  const val=p.qty*p.unit_price,bal=Math.max(0,val-p.advance);
                  return (<tr key={p.id}>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b'}}>{p.id}</td>
                    <td style={{fontWeight:500}}>{cust?.name||'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace"}}>{p.qty}</td>
                    <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(val)}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{fmtL(p.advance)}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:bal>0?'#f87171':'#34d399',fontWeight:600}}>{fmtL(bal)}</td>
                    <td><StatusBadge s={p.status}/></td>
                    <td><StagePipeline current={p.status}/></td>
                    <td><input style={{...inp,width:120,fontSize:11,padding:'4px 8px'}} placeholder="INV-001" defaultValue={p.invoice_no||''} onBlur={e=>{ if(e.target.value!==p.invoice_no) updatePOField(p.id,'invoice_no',e.target.value);}}/></td>
                    <td><input style={{...inp,width:130,fontSize:11,padding:'4px 8px'}} type="date" defaultValue={p.invoice_date||''} onBlur={e=>{ if(e.target.value!==p.invoice_date) updatePOField(p.id,'invoice_date',e.target.value);}}/></td>
                    <td><input style={{...inp,width:130,fontSize:11,padding:'4px 8px'}} type="date" defaultValue={p.dispatch_date||''} onBlur={e=>{ if(e.target.value!==p.dispatch_date) updatePOField(p.id,'dispatch_date',e.target.value);}}/></td>
                    <td><select style={{...inp,width:'auto',fontSize:11,padding:'4px 8px'}} value={p.status} onChange={e=>updatePOStatus(p.id,e.target.value)}>{PO_STAGES.map(s=><option key={s}>{s}</option>)}</select></td>
                  </tr>);
                })
              }</tbody>
            </table>
          </div>
        </div>)}

        {/* ═══════════════ PURCHASE ORDERS ═══════════════ */}
        {view==='pos'&&(<div>
          <div className="sec">All Purchase Orders</div>
          <div style={{...card,padding:20,marginBottom:20}}>
            <div style={{fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:14}}>+ NEW PURCHASE ORDER</div>
            <div style={{...g4,marginBottom:14}}>
              <div><label style={lbl}>Customer *</label><select style={inp} value={poForm.customer_id} onChange={e=>setPoForm({...poForm,customer_id:e.target.value})}><option value="">Select…</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label style={lbl}>Delivery *</label><select style={inp} value={poForm.delivery_type} onChange={e=>handleDeliveryChange(e.target.value)}><option value="DDP">DDP</option><option value="EXW">EXW</option></select></div>
              <div><label style={lbl}>Qty *</label><input style={inp} type="number" value={poForm.qty} onChange={e=>setPoForm({...poForm,qty:e.target.value})}/></div>
              <div><label style={lbl}>Unit Sell Price (₹) *</label><input style={inp} type="number" value={poForm.unit_price} onChange={e=>setPoForm({...poForm,unit_price:e.target.value})}/></div>
            </div>
            <div style={{background:'#0a0e1a',border:'1px solid #334155',borderRadius:10,padding:14,marginBottom:14}}>
              <div style={{fontSize:11,color:'#6366f1',fontFamily:"'DM Mono',monospace",marginBottom:10}}>VENDOR / PURCHASE DETAILS</div>
              <div style={{...g4}}>
                <div><label style={lbl}>Vendor</label><input style={{...inp,borderColor:poForm.vendor_name!=='Primary Manufacturer'?'#6366f1':'#334155'}} type="text" value={poForm.vendor_name} onChange={e=>setPoForm({...poForm,vendor_name:e.target.value})}/></div>
                <div><label style={lbl}>Purchase Price (₹) *</label><input style={{...inp,borderColor:Number(poForm.purchase_price)!==(poForm.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw)&&poForm.purchase_price?'#6366f1':'#334155'}} type="number" placeholder={`Default: ${fmtC(poForm.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw)}`} value={poForm.purchase_price} onChange={e=>setPoForm({...poForm,purchase_price:e.target.value})}/></div>
                <div><label style={lbl}>Vendor Invoice No.</label><input style={inp} type="text" value={poForm.vendor_invoice_no} onChange={e=>setPoForm({...poForm,vendor_invoice_no:e.target.value})}/></div>
                <div><label style={lbl}>Purchase Date</label><input style={inp} type="date" value={poForm.purchase_date} onChange={e=>setPoForm({...poForm,purchase_date:e.target.value})}/></div>
              </div>
            </div>
            <div style={{...g4}}>
              <div><label style={lbl}>Advance (₹) *</label><input style={inp} type="number" value={poForm.advance} onChange={e=>setPoForm({...poForm,advance:e.target.value})}/></div>
              <div><label style={lbl}>PO Date *</label><input style={inp} type="date" value={poForm.po_date} onChange={e=>setPoForm({...poForm,po_date:e.target.value})}/></div>
              <div><label style={lbl}>Status</label><select style={inp} value={poForm.status} onChange={e=>setPoForm({...poForm,status:e.target.value})}>{PO_STAGES.map(s=><option key={s}>{s}</option>)}</select></div>
              <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={addPO} disabled={saving} style={{...btn(saving),width:'100%',padding:'11px 0'}}>{saving?'Saving…':'ADD PO →'}</button></div>
            </div>
            {poForm.qty&&poForm.unit_price&&poForm.purchase_price&&(<div style={{marginTop:12,background:'#0a0e1a',borderRadius:8,padding:'8px 14px',fontSize:12,color:'#94a3b8',fontFamily:"'DM Mono',monospace",display:'flex',gap:20,flexWrap:'wrap'}}>
              <span>Invoice: <strong style={{color:'#f1f5f9'}}>{fmtL(poForm.qty*poForm.unit_price)}</strong></span>
              <span>Cost: <strong style={{color:'#f1f5f9'}}>{fmtL(poForm.qty*poForm.purchase_price)}</strong></span>
              <span>Profit: <strong style={{color:(poForm.qty*poForm.unit_price-poForm.qty*poForm.purchase_price)>=0?'#34d399':'#f87171'}}>{fmtL(poForm.qty*poForm.unit_price-poForm.qty*poForm.purchase_price)}</strong></span>
            </div>)}
          </div>
          <div style={{...card,overflow:'auto'}}>
            <table>
              <thead><tr>{['PO No','Customer','Type','Vendor','Buy Price','Qty','Sell Price','Value','Advance','Balance','Date','Stage','Update'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{pos.map(p=>{
                const cust=customers.find(c=>c.id===p.customer_id),gross=p.qty*p.unit_price,bal=Math.max(0,gross-p.advance),isAlt=p.vendor_name&&p.vendor_name!=='Primary Manufacturer';
                return (<tr key={p.id}>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b'}}>{p.id}</td>
                  <td style={{fontWeight:500}}>{cust?.name||'—'}</td>
                  <td><span style={{fontSize:11,background:p.delivery_type==='DDP'?'#1e3a5f':'#1e3a2f',color:p.delivery_type==='DDP'?'#38bdf8':'#34d399',borderRadius:4,padding:'2px 5px',fontFamily:"'DM Mono',monospace"}}>{p.delivery_type}</span></td>
                  <td><div style={{fontSize:12}}>{p.vendor_name||'Primary'}</div>{isAlt&&<div style={{fontSize:10,color:'#6366f1'}}>⚡ ALT</div>}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:isAlt?'#6366f1':'#94a3b8'}}>{fmtC(p.purchase_price)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{p.qty}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtC(p.unit_price)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(gross)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{fmtL(p.advance)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:bal>0?'#f87171':'#34d399'}}>{fmtL(bal)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:11}}>{p.po_date}</td>
                  <td><StatusBadge s={p.status}/></td>
                  <td><select style={{...inp,width:'auto',fontSize:11,padding:'3px 6px'}} value={p.status} onChange={e=>updatePOStatus(p.id,e.target.value)}>{PO_STAGES.map(s=><option key={s}>{s}</option>)}</select></td>
                </tr>);
              })}</tbody>
            </table>
          </div>
        </div>)}

        {/* ═══════════════ CREDIT NOTES ═══════════════ */}
        {view==='cns'&&(<div>
          <div className="sec">Credit Notes & FOC (to Customers)</div>
          <div style={{...card,padding:20,marginBottom:20}}>
            <div style={{fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:14}}>+ NEW CN / FOC</div>
            <div style={{...g4}}>
              <div><label style={lbl}>Linked PO *</label><select style={inp} value={cnForm.po_id} onChange={e=>setCnForm({...cnForm,po_id:e.target.value})}><option value="">Select PO…</option>{pos.map(p=>{ const c=customers.find(x=>x.id===p.customer_id); return <option key={p.id} value={p.id}>{p.id} — {c?.name}</option>; })}</select></div>
              <div><label style={lbl}>Type *</label><select style={inp} value={cnForm.type} onChange={e=>setCnForm({...cnForm,type:e.target.value})}><option value="CNNote">Credit Note</option><option value="FOC">FOC Units</option></select></div>
              {cnForm.type==='CNNote'&&<div><label style={lbl}>Amount (₹)</label><input style={inp} type="number" value={cnForm.amount} onChange={e=>setCnForm({...cnForm,amount:e.target.value})}/></div>}
              {cnForm.type==='FOC'&&<div><label style={lbl}>FOC Units</label><input style={inp} type="number" value={cnForm.foc_units} onChange={e=>setCnForm({...cnForm,foc_units:e.target.value})}/></div>}
              <div><label style={lbl}>Date *</label><input style={inp} type="date" value={cnForm.cn_date} onChange={e=>setCnForm({...cnForm,cn_date:e.target.value})}/></div>
              <div><label style={lbl}>Remarks</label><input style={inp} type="text" value={cnForm.note} onChange={e=>setCnForm({...cnForm,note:e.target.value})}/></div>
              <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={addCN} disabled={saving} style={{...btn(saving),width:'100%',padding:'11px 0'}}>{saving?'Saving…':'ADD →'}</button></div>
            </div>
          </div>
          <div style={{...card,overflow:'hidden'}}>
            <table>
              <thead><tr>{['ID','PO','Customer','Type','CN Amount','FOC Units','FOC Cost','Date','Remarks'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{cns.map(c=>{ const cust=customers.find(x=>x.id===c.customer_id),po=pos.find(p=>p.id===c.po_id),fc=c.type==='FOC'?c.foc_units*Number(po?.purchase_price||0):0; return (
                <tr key={c.id}>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b'}}>{c.id}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{c.po_id}</td>
                  <td>{cust?.name||'—'}</td>
                  <td><span style={{fontSize:11,background:c.type==='CNNote'?'#2d1f3d':'#1f2d1f',color:c.type==='CNNote'?'#c084fc':'#4ade80',borderRadius:4,padding:'2px 5px',fontFamily:"'DM Mono',monospace"}}>{c.type==='CNNote'?'CN':'FOC'}</span></td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171'}}>{c.type==='CNNote'?fmtL(c.amount):'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#e879f9'}}>{c.type==='FOC'?c.foc_units:'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171'}}>{c.type==='FOC'?fmtL(fc):'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b'}}>{c.cn_date}</td>
                  <td style={{color:'#94a3b8',fontSize:12}}>{c.note}</td>
                </tr>
              );})}</tbody>
            </table>
          </div>
        </div>)}

        {/* ═══════════════ CUSTOMERS ═══════════════ */}
        {view==='customers'&&(<div>
          <div className="sec">Customer Master</div>
          <div style={{...card,padding:20,marginBottom:20}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:14,alignItems:'flex-end'}}>
              <div><label style={lbl}>Customer Name</label><input style={inp} type="text" value={custForm.name} onChange={e=>setCustForm({...custForm,name:e.target.value})}/></div>
              <div><label style={lbl}>GSTIN</label><input style={inp} type="text" value={custForm.gstin} onChange={e=>setCustForm({...custForm,gstin:e.target.value})}/></div>
              <button onClick={addCustomer} disabled={saving} style={btn(saving)}>{saving?'Saving…':'ADD →'}</button>
            </div>
          </div>
          <div style={{...card,overflow:'hidden'}}>
            <table>
              <thead><tr>{['#','Name','GSTIN','POs','Net Sales','Profit','Margin','Pending','Status'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{customers.map((c,i)=>{ const a=analytics.perCustomer.find(x=>x.id===c.id); return (
                <tr key={c.id}>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b'}}>{i+1}</td>
                  <td style={{fontWeight:500}}>{c.name}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:11}}>{c.gstin||'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{pos.filter(p=>p.customer_id===c.id).length}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(a?.netSales||0)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:(a?.profit||0)>=0?'#34d399':'#f87171'}}>{fmtL(a?.profit||0)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{pct(a?.margin||0)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:(a?.pending||0)>0?'#f87171':'#34d399'}}>{fmtL(a?.pending||0)}</td>
                  <td>{a?.atRisk?<span style={{fontSize:10,background:'#450a0a',color:'#f87171',border:'1px solid #7f1d1d',borderRadius:6,padding:'2px 6px',fontFamily:"'DM Mono',monospace"}}>⚠ RISK</span>:<span style={{fontSize:10,background:'#052e16',color:'#34d399',border:'1px solid #14532d',borderRadius:6,padding:'2px 6px',fontFamily:"'DM Mono',monospace"}}>✓ OK</span>}</td>
                </tr>
              );})}</tbody>
            </table>
          </div>
        </div>)}

        {/* ═══════════════ SIMULATOR ═══════════════ */}
        {view==='simulator'&&(<div>
          <div className="sec">Discount Simulator</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
            <div style={{...card,padding:20}}>
              <div style={{fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:12}}>STEP 1 — CUSTOMER & EXISTING DISCOUNTS</div>
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div><label style={lbl}>Customer</label><select style={inp} value={sim.customerId} onChange={e=>setSim({...sim,customerId:e.target.value})}><option value="">Select…</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  <div><label style={lbl}>Extra CN (₹)</label><input style={inp} type="number" placeholder="0" value={sim.extraCN} onChange={e=>setSim({...sim,extraCN:e.target.value})}/></div>
                  <div><label style={lbl}>Extra FOC Units</label><input style={inp} type="number" placeholder="0" value={sim.extraFOC} onChange={e=>setSim({...sim,extraFOC:e.target.value})}/></div>
                </div>
              </div>
            </div>
            <div style={{...card,padding:20}}>
              <div style={{fontSize:12,color:'#38bdf8',fontFamily:"'DM Mono',monospace",marginBottom:12}}>STEP 2 — NEW PO SCENARIO (OPTIONAL)</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><label style={lbl}>New PO Qty</label><input style={inp} type="number" placeholder="0" value={sim.newPoQty} onChange={e=>setSim({...sim,newPoQty:e.target.value})}/></div>
                <div><label style={lbl}>Sell Price (₹)</label><input style={inp} type="number" placeholder="0" value={sim.newPoUnitPrice} onChange={e=>setSim({...sim,newPoUnitPrice:e.target.value})}/></div>
                <div><label style={lbl}>Purchase Price (₹)</label><input style={inp} type="number" placeholder={fmtC(settings.default_purchase_price_ddp)} value={sim.newPoPurchasePrice} onChange={e=>setSim({...sim,newPoPurchasePrice:e.target.value})}/></div>
                <div><label style={lbl}>CN on New PO (₹)</label><input style={inp} type="number" placeholder="0" value={sim.newPoCNAmount} onChange={e=>setSim({...sim,newPoCNAmount:e.target.value})}/></div>
                <div><label style={lbl}>FOC on New PO</label><input style={inp} type="number" placeholder="0" value={sim.newPoFOCUnits} onChange={e=>setSim({...sim,newPoFOCUnits:e.target.value})}/></div>
              </div>
            </div>
          </div>
          {simResult&&(<div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14}}>
            <div style={{...card,padding:18}}>
              <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:12,textTransform:'uppercase'}}>Current — {simResult.cust.name}</div>
              {[['Net Sales',fmtL(simResult.cust.netSales),'#38bdf8'],['Cost',fmtL(simResult.cust.purchCost),'#94a3b8'],['Profit',fmtL(simResult.cust.profit),simResult.cust.profit>=0?'#34d399':'#f87171'],['Margin',pct(simResult.cust.margin),simResult.cust.margin>=0?'#34d399':'#f87171'],['Avg SP',fmtC(simResult.cust.avgSP),'#f59e0b'],['Avg PP',fmtC(simResult.cust.avgPP),'#94a3b8']].map(([l,v,c])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #1e293b'}}><span style={{fontSize:12,color:'#64748b'}}>{l}</span><span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:c}}>{v}</span></div>
              ))}
            </div>
            {simResult.hasNewPO&&(<div style={{...card,padding:18}}>
              <div style={{fontSize:10,color:'#38bdf8',fontFamily:"'DM Mono',monospace",marginBottom:12,textTransform:'uppercase'}}>New PO Standalone</div>
              {[['Qty',simResult.nq,'#e2e8f0'],['Revenue',fmtL(simResult.nq*simResult.nup),'#38bdf8'],['CN',`−${fmtL(simResult.nCN)}`,'#f87171'],['Cost',fmtL(simResult.nq*simResult.npp),'#94a3b8'],['Gross Profit',fmtL(simResult.nPGP),simResult.nPGP>=0?'#34d399':'#f87171']].map(([l,v,c])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #1e293b'}}><span style={{fontSize:12,color:'#64748b'}}>{l}</span><span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:c}}>{v}</span></div>
              ))}
            </div>)}
            <div style={{...card,border:`1px solid ${simResult.willLoss?'#7f1d1d':'#14532d'}`,padding:18}}>
              <div style={{fontSize:10,color:simResult.willLoss?'#f87171':'#34d399',fontFamily:"'DM Mono',monospace",marginBottom:12,textTransform:'uppercase'}}>{simResult.willLoss?'⚠ COMBINED — LOSS':'✓ COMBINED — PROFITABLE'}</div>
              {[['Total Qty',simResult.cTQ,'#e2e8f0'],['Net Sales',fmtL(simResult.cNS),'#38bdf8'],['Total Cost',fmtL(simResult.cPC),'#94a3b8'],['Net Profit',fmtL(simResult.cP),simResult.cP>=0?'#34d399':'#f87171'],['Margin',pct(simResult.cM),simResult.cM>=0?'#34d399':'#f87171'],['Avg SP',fmtC(simResult.cASP),'#f59e0b'],['Avg PP',fmtC(simResult.cAPP),'#94a3b8']].map(([l,v,c])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #1e293b20'}}><span style={{fontSize:12,color:'#64748b'}}>{l}</span><span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:c}}>{v}</span></div>
              ))}
              <div style={{marginTop:12}}>{simResult.willLoss?<AlertBox msg="Combined position turns to LOSS."/>:<div style={{background:'#052e16',border:'1px solid #14532d',color:'#34d399',borderRadius:8,padding:'8px 12px',fontSize:11,fontFamily:"'DM Mono',monospace"}}>✓ Safe to proceed.</div>}</div>
            </div>
          </div>)}
          {!simResult&&<div style={{color:'#475569',fontSize:13,marginTop:8}}>← Select a customer to begin.</div>}
        </div>)}

        {/* ═══════════════ MFR CNs ═══════════════ */}
        {view==='mfrcn'&&(<div>
          <div className="sec">Manufacturer Credit Notes</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:20}}>
            {(()=>{ const tCN=mfrCNAnalytics.reduce((s,c)=>s+Number(c.total_value),0),tU=mfrCNAnalytics.reduce((s,c)=>s+c.totalUsed,0),tB=mfrCNAnalytics.reduce((s,c)=>s+c.balance,0); return [
              {label:'Total Mfr CNs',val:fmtL(tCN),color:'#34d399'},
              {label:'Expenses Booked',val:fmtL(tU),color:'#f87171'},
              {label:'Available Balance',val:fmtL(tB),color:tB>=0?'#f59e0b':'#f87171'},
              {label:'No. of CNs',val:mfrCNs.length,color:'#94a3b8'},
            ];})().map(k=><div key={k.label} className="kc"><div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:8,textTransform:'uppercase'}}>{k.label}</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:22,color:k.color}}>{k.val}</div></div>)}
          </div>
          <div style={{...card,padding:20,marginBottom:20}}>
            <div style={{fontSize:12,color:'#34d399',fontFamily:"'DM Mono',monospace",marginBottom:12}}>+ NEW MANUFACTURER CN</div>
            <div style={{...g4}}>
              <div><label style={lbl}>CN Ref *</label><input style={inp} type="text" placeholder="MFR-CN-001" value={mfrCNForm.cn_ref} onChange={e=>setMfrCNForm({...mfrCNForm,cn_ref:e.target.value})}/></div>
              <div><label style={lbl}>Date *</label><input style={inp} type="date" value={mfrCNForm.cn_date} onChange={e=>setMfrCNForm({...mfrCNForm,cn_date:e.target.value})}/></div>
              <div><label style={lbl}>Total Value (₹) *</label><input style={inp} type="number" value={mfrCNForm.total_value} onChange={e=>setMfrCNForm({...mfrCNForm,total_value:e.target.value})}/></div>
              <div><label style={lbl}>Description</label><input style={inp} type="text" value={mfrCNForm.description} onChange={e=>setMfrCNForm({...mfrCNForm,description:e.target.value})}/></div>
            </div>
            <button onClick={addMfrCN} disabled={saving} style={{...btn(false,'#34d399','#0a0e1a'),marginTop:12}}>{saving?'Saving…':'ADD CN →'}</button>
          </div>
          <div style={{...card,padding:20,marginBottom:20}}>
            <div style={{fontSize:12,color:'#f87171',fontFamily:"'DM Mono',monospace",marginBottom:12}}>+ BOOK EXPENSE</div>
            <div style={{...g4,marginBottom:12}}>
              <div><label style={lbl}>Manufacturer CN *</label><select style={inp} value={expForm.mfr_cn_id} onChange={e=>setExpForm({...expForm,mfr_cn_id:e.target.value})}><option value="">Select CN…</option>{mfrCNAnalytics.map(c=><option key={c.id} value={c.id}>{c.cn_ref} — Bal: {fmtL(c.balance)}</option>)}</select></div>
              <div><label style={lbl}>Expense Name *</label><input style={inp} type="text" value={expForm.expense_name} onChange={e=>setExpForm({...expForm,expense_name:e.target.value})}/></div>
              <div><label style={lbl}>Date *</label><input style={inp} type="date" value={expForm.expense_date} onChange={e=>setExpForm({...expForm,expense_date:e.target.value})}/></div>
              <div><label style={lbl}>Amount excl GST (₹) *</label><input style={inp} type="number" value={expForm.amount} onChange={e=>setExpForm({...expForm,amount:e.target.value})}/></div>
              <div><label style={lbl}>GST Rate</label><select style={inp} value={expForm.gst_rate} onChange={e=>setExpForm({...expForm,gst_rate:e.target.value})}>{GST_RATES.map(r=><option key={r} value={r}>{r}%</option>)}</select></div>
              <div><label style={lbl}>Vendor</label><input style={inp} type="text" value={expForm.vendor_name} onChange={e=>setExpForm({...expForm,vendor_name:e.target.value})}/></div>
              <div><label style={lbl}>Invoice Ref</label><input style={inp} type="text" value={expForm.invoice_ref} onChange={e=>setExpForm({...expForm,invoice_ref:e.target.value})}/></div>
              <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={addExpense} disabled={saving} style={{...btn(saving,'#dc2626','#fff'),width:'100%',padding:'11px 0'}}>{saving?'Saving…':'BOOK →'}</button></div>
            </div>
            {expForm.amount&&(<div style={{background:'#0a0e1a',borderRadius:8,padding:'8px 14px',fontSize:12,color:'#94a3b8',fontFamily:"'DM Mono',monospace",display:'flex',gap:20}}>
              <span>Base: <strong style={{color:'#f1f5f9'}}>{fmtL(expForm.amount)}</strong></span>
              <span>GST: <strong style={{color:'#f87171'}}>{fmtL(expForm.amount*expForm.gst_rate/100)}</strong></span>
              <span>Total: <strong style={{color:'#f59e0b'}}>{fmtL(Number(expForm.amount)*(1+Number(expForm.gst_rate)/100))}</strong></span>
            </div>)}
          </div>
          {mfrCNAnalytics.map(cn=>(
            <div key={cn.id} style={{...card,marginBottom:12,overflow:'hidden'}}>
              <div style={{display:'flex',alignItems:'center',gap:14,padding:'14px 20px',cursor:'pointer',borderBottom:expandedMfrCN===cn.id?'1px solid #1e293b':'none'}} onClick={()=>setExpandedMfrCN(expandedMfrCN===cn.id?null:cn.id)}>
                <div style={{fontFamily:"'DM Mono',monospace",color:'#34d399',fontSize:14,fontWeight:500}}>{cn.cn_ref}</div>
                <div style={{fontSize:12,color:'#64748b'}}>{cn.cn_date}</div>
                {cn.description&&<div style={{fontSize:12,color:'#94a3b8'}}>{cn.description}</div>}
                <div style={{marginLeft:'auto',display:'flex',gap:20,alignItems:'center'}}>
                  {[['Total',cn.total_value,'#34d399'],['Used',cn.totalUsed,'#f87171'],['Balance',cn.balance,cn.balance>=0?'#f59e0b':'#f87171']].map(([l,v,c])=>(
                    <div key={l} style={{textAlign:'right'}}><div style={{fontSize:10,color:'#64748b'}}>{l}</div><div style={{fontFamily:"'DM Mono',monospace",color:c,fontWeight:l==='Balance'?700:400}}>{fmtL(v)}</div></div>
                  ))}
                  <div style={{width:80}}><div style={{height:4,background:'#1e293b',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(100,(cn.totalUsed/cn.total_value)*100)}%`,background:'#f59e0b',borderRadius:2}}/></div><div style={{fontSize:9,color:'#475569',marginTop:2,fontFamily:"'DM Mono',monospace"}}>{Math.min(100,((cn.totalUsed/cn.total_value)*100)).toFixed(0)}% used</div></div>
                  <div style={{color:'#475569'}}>{expandedMfrCN===cn.id?'▲':'▼'}</div>
                </div>
              </div>
              {expandedMfrCN===cn.id&&(cn.expenses.length===0
                ?<div style={{padding:'14px 20px',color:'#475569',fontSize:13}}>No expenses booked yet.</div>
                :<table><thead><tr>{['Expense','Date','Base','GST%','GST','Total','Vendor','Ref'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>{cn.expenses.map(e=><tr key={e.id}>
                  <td style={{fontWeight:500}}>{e.expense_name}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:11}}>{e.expense_date}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(e.amount)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#94a3b8'}}>{e.gst_rate}%</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171'}}>{fmtL(e.gst_amount)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171',fontWeight:600}}>{fmtL(e.total_amount)}</td>
                  <td style={{color:'#94a3b8',fontSize:11}}>{e.vendor_name||'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:11}}>{e.invoice_ref||'—'}</td>
                </tr>)}</tbody></table>
              )}
            </div>
          ))}
        </div>)}

        {/* ═══════════════ SETTINGS ═══════════════ */}
        {view==='settings'&&(<div>
          <div className="sec">Settings</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
            {/* MSA Prices */}
            <div style={{...card,padding:24}}>
              <div style={{fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:16}}>MSA DEFAULT PURCHASE PRICES</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:20}}>
                <div><label style={lbl}>EXW (₹)</label><input style={inp} type="number" value={settingsForm.exw} onChange={e=>setSettingsForm({...settingsForm,exw:e.target.value})}/><div style={{fontSize:10,color:'#475569',marginTop:3}}>Active: {fmtC(settings.default_purchase_price_exw)}</div></div>
                <div><label style={lbl}>DDP (₹)</label><input style={inp} type="number" value={settingsForm.ddp} onChange={e=>setSettingsForm({...settingsForm,ddp:e.target.value})}/><div style={{fontSize:10,color:'#475569',marginTop:3}}>Active: {fmtC(settings.default_purchase_price_ddp)}</div></div>
              </div>
              <button onClick={saveSettings} disabled={saving} style={btn(saving)}>{saving?'Saving…':'SAVE PRICES →'}</button>
            </div>

            {/* Annual Targets */}
            <div style={{...card,padding:24}}>
              <div style={{fontSize:12,color:'#38bdf8',fontFamily:"'DM Mono',monospace",marginBottom:16}}>ANNUAL TARGETS</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                <div><label style={lbl}>FY Label *</label><input style={inp} type="text" placeholder="FY 2024-25" value={targetForm.fy_label} onChange={e=>setTargetForm({...targetForm,fy_label:e.target.value})}/></div>
                <div><label style={lbl}>FY Start *</label><input style={inp} type="date" value={targetForm.fy_start} onChange={e=>setTargetForm({...targetForm,fy_start:e.target.value})}/></div>
                <div><label style={lbl}>FY End *</label><input style={inp} type="date" value={targetForm.fy_end} onChange={e=>setTargetForm({...targetForm,fy_end:e.target.value})}/></div>
                <div><label style={lbl}>Target Units *</label><input style={inp} type="number" value={targetForm.target_units} onChange={e=>setTargetForm({...targetForm,target_units:e.target.value})}/></div>
                <div><label style={lbl}>Target Revenue (₹) *</label><input style={inp} type="number" value={targetForm.target_value} onChange={e=>setTargetForm({...targetForm,target_value:e.target.value})}/></div>
                <div><label style={lbl}>Target Profit (₹)</label><input style={inp} type="number" value={targetForm.target_profit} onChange={e=>setTargetForm({...targetForm,target_profit:e.target.value})}/></div>
                <div><label style={lbl}>Mfr Slab 1 — Units</label><input style={inp} type="number" placeholder="e.g. 50" value={targetForm.mfr_slab_1_units} onChange={e=>setTargetForm({...targetForm,mfr_slab_1_units:e.target.value})}/></div>
                <div><label style={lbl}>Mfr Slab 1 — Bonus (₹)</label><input style={inp} type="number" placeholder="e.g. 200000" value={targetForm.mfr_slab_1_bonus} onChange={e=>setTargetForm({...targetForm,mfr_slab_1_bonus:e.target.value})}/></div>
                <div><label style={lbl}>Mfr Slab 2 — Units</label><input style={inp} type="number" placeholder="e.g. 100" value={targetForm.mfr_slab_2_units} onChange={e=>setTargetForm({...targetForm,mfr_slab_2_units:e.target.value})}/></div>
                <div><label style={lbl}>Mfr Slab 2 — Bonus (₹)</label><input style={inp} type="number" placeholder="e.g. 500000" value={targetForm.mfr_slab_2_bonus} onChange={e=>setTargetForm({...targetForm,mfr_slab_2_bonus:e.target.value})}/></div>
              </div>
              <button onClick={saveTarget} disabled={saving} style={{...btn(saving,'#38bdf8','#0a0e1a')}}>{saving?'Saving…':'SAVE TARGET →'}</button>
              {targets.length>0&&(<div style={{marginTop:16}}><div style={{fontSize:11,color:'#475569',fontFamily:"'DM Mono',monospace",marginBottom:8}}>SAVED TARGETS</div>{targets.map(t=><div key={t.id} style={{fontSize:12,color:'#64748b',padding:'4px 0',borderBottom:'1px solid #1e293b'}}>{t.fy_label} — {fmt(t.target_units)} units · {fmtL(t.target_value)}</div>)}</div>)}
            </div>
          </div>
        </div>)}

        </>)}
      </div>
    </div>
  );
}
