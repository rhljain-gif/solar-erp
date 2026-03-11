import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';

const COMPANY = {
  name: 'Basilsphere Innovations Private Limited',
  short: 'BSIPL',
  gstin: '07AANCB6176G1ZD',
  address: '17-18, Level 5, Punj Essen House, Regus Evergsun Business Centre Pvt. Ltd., New Delhi – 110019',
  email: 'office@bsipl.com',
  poPrefix: 'BSIPL/PO/',
};
const MANUFACTURER = {
  name: 'WattPower Systems Private Limited',
  gstin: '33AADCW3840N1Z3',
  address: 'Plot No. K-24, SIPCOT Industrial Park, Mambakkam, Sriperumbuddur Taluk, Kancheepuram Dist., Tamil Nadu-602105',
};

const VENDOR_TYPES = ['Manufacturer','Transporter','Installer','Service Provider','Other'];

const fmt  = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);
const fmtC = n => '₹' + fmt(n);
const pct  = n => isFinite(n) && !isNaN(n) ? n.toFixed(1) + '%' : '—';
const fmtL = n => { if (!n) return '₹0'; if (Math.abs(n) >= 1e7) return '₹' + (n/1e7).toFixed(2) + 'Cr'; if (Math.abs(n) >= 1e5) return '₹' + (n/1e5).toFixed(1) + 'L'; return fmtC(n); };

const PO_STAGES   = ['PO Received','Advance Received','Invoice Raised','Shipment Dispatched','Delivered / Fulfilled'];
const GST_RATES   = [0,5,12,18,28];
const EXP_CATS    = ['Salary','Rent','Travel','Professional Fees','Utilities','Marketing','Logistics','Insurance','Office Supplies','Other'];
const PAY_MODES   = ['Bank Transfer','Cash','Cheque','UPI','Credit Card'];

// Salary has no GST, insurance has no GST — helper
const catHasGST   = cat => !['Salary','Insurance'].includes(cat);

const FY_MONTHS = fy => {
  const yr = parseInt(fy.replace('FY ','').split('-')[0]);
  return [
    {label:'Apr',start:`${yr}-04-01`,end:`${yr}-04-30`},
    {label:'May',start:`${yr}-05-01`,end:`${yr}-05-31`},
    {label:'Jun',start:`${yr}-06-01`,end:`${yr}-06-30`},
    {label:'Jul',start:`${yr}-07-01`,end:`${yr}-07-31`},
    {label:'Aug',start:`${yr}-08-01`,end:`${yr}-08-31`},
    {label:'Sep',start:`${yr}-09-01`,end:`${yr}-09-30`},
    {label:'Oct',start:`${yr}-10-01`,end:`${yr}-10-31`},
    {label:'Nov',start:`${yr}-11-01`,end:`${yr}-11-30`},
    {label:'Dec',start:`${yr}-12-01`,end:`${yr}-12-31`},
    {label:'Jan',start:`${yr+1}-01-01`,end:`${yr+1}-01-31`},
    {label:'Feb',start:`${yr+1}-02-01`,end:`${yr+1}-02-28`},
    {label:'Mar',start:`${yr+1}-03-01`,end:`${yr+1}-03-31`},
  ];
};

const stageColor = s => ({'PO Received':{bg:'#1e1a3f',color:'#a78bfa',border:'#4c1d95'},'Advance Received':{bg:'#1a2e3f',color:'#38bdf8',border:'#0c4a6e'},'Invoice Raised':{bg:'#1f2d1f',color:'#4ade80',border:'#14532d'},'Shipment Dispatched':{bg:'#451a03',color:'#fb923c',border:'#7c2d12'},'Delivered / Fulfilled':{bg:'#052e16',color:'#34d399',border:'#14532d'}}[s]||{bg:'#1e293b',color:'#94a3b8',border:'#334155'});
const StatusBadge = ({s}) => { const c=stageColor(s); return <span style={{background:c.bg,color:c.color,border:`1px solid ${c.border}`,fontSize:11,padding:'2px 8px',borderRadius:6,fontFamily:"'DM Mono',monospace",whiteSpace:'nowrap'}}>{s}</span>; };
const AlertBox = ({msg}) => <div style={{display:'flex',alignItems:'center',gap:8,background:'#450a0a',border:'1px solid #7f1d1d',color:'#f87171',borderRadius:8,padding:'10px 14px',fontSize:12,fontFamily:"'DM Mono',monospace"}}><span>⚠</span>{msg}</div>;
const Spinner  = () => <div style={{textAlign:'center',padding:40,color:'#475569',fontFamily:"'DM Mono',monospace",fontSize:13}}>Loading…</div>;

const StagePipeline = ({current}) => {
  const idx = PO_STAGES.indexOf(current);
  return <div style={{display:'flex',alignItems:'center'}}>{PO_STAGES.map((s,i)=><div key={s} style={{display:'flex',alignItems:'center'}}><div style={{width:9,height:9,borderRadius:'50%',background:i<=idx?'#34d399':'#1e293b',border:i===idx?'2px solid #34d399':'1px solid #334155'}} title={s}/>{i<PO_STAGES.length-1&&<div style={{width:12,height:2,background:i<idx?'#34d399':'#1e293b'}}/>}</div>)}</div>;
};

const Ring = ({value,max,color,size=80,label}) => {
  const r=28,circ=2*Math.PI*r,p=Math.min(1,(value||0)/(max||1)),dash=p*circ;
  return <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
    <svg width={size} height={size} viewBox="0 0 70 70">
      <circle cx="35" cy="35" r={r} fill="none" stroke="#1e293b" strokeWidth="8"/>
      <circle cx="35" cy="35" r={r} fill="none" stroke={color} strokeWidth="8" strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform="rotate(-90 35 35)"/>
      <text x="35" y="35" textAnchor="middle" dy="0.35em" fill={color} fontSize="11" fontFamily="'DM Mono',monospace">{Math.round(p*100)}%</text>
    </svg>
    {label&&<div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",textAlign:'center'}}>{label}</div>}
  </div>;
};

const BarChart = ({data,valueKey,labelKey,color='#f59e0b',height=80}) => {
  const max=Math.max(...data.map(d=>d[valueKey]||0),1);
  return <div style={{display:'flex',alignItems:'flex-end',gap:3,height:height+24}}>{data.map((d,i)=><div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}><div style={{width:'100%',background:color,borderRadius:'3px 3px 0 0',height:`${((d[valueKey]||0)/max)*height}px`,minHeight:d[valueKey]?2:0}}/><div style={{fontSize:9,color:'#475569',fontFamily:"'DM Mono',monospace",transform:'rotate(-30deg)',transformOrigin:'top center',marginTop:4,whiteSpace:'nowrap'}}>{d[labelKey]}</div></div>)}</div>;
};

// Category colour dots
const catColor = cat => ({'Salary':'#38bdf8','Rent':'#a78bfa','Travel':'#fb923c','Professional Fees':'#f59e0b','Utilities':'#34d399','Marketing':'#e879f9','Logistics':'#4ade80','Insurance':'#94a3b8','Office Supplies':'#67e8f9','Other':'#64748b'}[cat]||'#64748b');

export default function DashboardPage() {
  const { user, signOut } = useAuth();
  const [view,setView]         = useState('dashboard');
  const [customers,setCust]    = useState([]);
  const [pos,setPos]           = useState([]);
  const [cns,setCns]           = useState([]);
  const [mfrCNs,setMfrCNs]     = useState([]);
  const [mfrExp,setMfrExp]     = useState([]);
  const [targets,setTargets]   = useState([]);
  const [pipeline,setPipeline] = useState([]);
  const [cashTxns,setCashTxns] = useState([]);
  const [bizExp,setBizExp]     = useState([]);
  const [vendors,setVendors]   = useState([]);
  const [deliveries,setDeliveries] = useState([]);
  const [pis,setPIs]           = useState([]);
  const [sites,setSites]       = useState([]);
  const [receipts,setReceipts] = useState([]);
  const [ledgerCust,setLedgerCust] = useState(null);
  const [settings,setSettings] = useState({default_purchase_price_exw:400000,default_purchase_price_ddp:403000,gst_rate_sales:12});
  const [loading,setLoading]   = useState(true);
  const [saving,setSaving]     = useState(false);
  const [toast,setToast]       = useState('');
  const [selectedFY,setFY]     = useState('FY 2024-25');
  const [expandedMfrCN,setExpandedMfrCN] = useState(null);
  const [expCatFilter,setExpCatFilter]   = useState('All');
  const [searchPO,setSearchPO]           = useState('');
  const [searchCust,setSearchCust]       = useState('');
  const [searchVendor,setSearchVendor]   = useState('');

  // Forms
  const blankPO = s => ({po_id:'',customer_id:'',delivery_type:'DDP',qty:'',unit_price:'',discount_pct:'0',discount_amount:'0',purchase_price:s.default_purchase_price_ddp,vendor_id:'',vendor_invoice_no:'',purchase_date:'',advance:'',po_date:'',status:'PO Received',invoice_no:'',invoice_date:'',dispatch_date:'',delivered_qty:'0'});
  const [poForm,setPoForm]       = useState(blankPO(settings));
  const [cnForm,setCnForm]       = useState({po_id:'',type:'CNNote',amount:'',foc_units:'',discount_amount:'',cn_date:'',note:''});
  const [custForm,setCustForm]   = useState({customer_code:'',name:'',gstin:'',contact_name:'',phone:'',email:'',address:''});
  const [vendorForm,setVendorForm] = useState({name:'',vendor_type:'Manufacturer',gstin:'',contact_name:'',phone:'',email:'',address:'',notes:''});
  const [deliveryForm,setDeliveryForm] = useState({po_id:'',delivery_date:'',qty_delivered:'',notes:''});
  const [sim,setSim]             = useState({customerId:'',extraCN:'',extraFOC:'',newPoQty:'',newPoUnitPrice:'',newPoPurchasePrice:'',newPoCNAmount:'',newPoFOCUnits:''});
  const [settingsForm,setSettingsForm] = useState({exw:'',ddp:'',gst_rate:''});
  const [mfrCNForm,setMfrCNForm] = useState({cn_ref:'',cn_date:'',total_value:'',description:''});
  const [expForm,setExpForm]     = useState({mfr_cn_id:'',expense_name:'',expense_date:'',amount:'',gst_rate:'18',vendor_name:'',invoice_ref:'',notes:''});
  const [pipeForm,setPipeForm]   = useState({customer_id:'',expected_qty:'',expected_value:'',expected_date:'',delivery_type:'DDP',probability:'75',notes:'',status:'Active'});
  const [cashForm,setCashForm]   = useState({txn_date:'',txn_type:'Cash In',category:'Balance Receipt',amount:'',reference_po:'',description:''});
  const [targetForm,setTargetForm] = useState({fy_label:'',fy_start:'',fy_end:'',target_units:'',target_value:'',target_profit:'',mfr_slab_1_units:'',mfr_slab_1_bonus:'',mfr_slab_2_units:'',mfr_slab_2_bonus:'',notes:''});
  const [bizExpForm,setBizExpForm] = useState({expense_date:'',category:'Rent',description:'',vendor_name:'',invoice_ref:'',amount:'',gst_rate:'0',is_gst_claimable:true,payment_mode:'Bank Transfer',notes:''});
  const [piForm,setPiForm]       = useState({pi_number:'',po_id:'',customer_id:'',pi_date:'',amount:'',gst_amount:'',total_amount:'',advance_due:'',advance_received:'',advance_date:'',payment_terms:'100% Advance against PI',status:'Pending',notes:''});
  const [siteForm,setSiteForm]   = useState({po_id:'',site_name:'',address:'',gstin:'',contact_name:'',phone:'',qty:'',notes:''});
  const [receiptForm,setReceiptForm] = useState({receipt_no:'',customer_id:'',po_id:'',receipt_date:'',amount:'',payment_mode:'Bank Transfer',reference:'',notes:''});

  const [editPO,setEditPO]           = useState(null);
  const [editForm,setEditForm]       = useState({});
  const [editCustomer,setEditCustomer] = useState(null);
  const [editCustForm,setEditCustForm] = useState({});
  const [confirmDelete,setConfirmDelete] = useState(null);

  const openEditCustomer = c => {
    setEditCustForm({
      customer_code: c.customer_code||'',
      name: c.name||'',
      gstin: c.gstin||'',
      contact_name: c.contact_name||'',
      phone: c.phone||'',
      email: c.email||'',
      address: c.address||'',
    });
    setEditCustomer(c);
  };

  const saveEditCustomer = async () => {
    if (!editCustForm.name) { showToast('Customer name is required'); return; }
    setSaving(true);
    const {error}=await supabase.from('customers').update(editCustForm).eq('id',editCustomer.id);
    if (error) showToast('Error: '+(error.message.includes('unique')?`Code "${editCustForm.customer_code}" already in use`:error.message));
    else { showToast('Customer updated ✓'); setEditCustomer(null); await fetchAll(); }
    setSaving(false);
  };

  const askDelete = (type, id, label, onConfirm) => setConfirmDelete({type,id,label,onConfirm});

  const deletePO = async (id) => {
    const linked = cns.filter(c=>c.po_id===id);
    if (linked.length>0) { showToast(`⛔ Cannot delete — ${linked.length} CN/FOC linked to this PO. Remove them first.`); return; }
    setSaving(true);
    await supabase.from('purchase_orders').delete().eq('id',id);
    showToast('PO deleted'); await fetchAll(); setSaving(false);
  };

  const deleteCN = async (id) => {
    setSaving(true);
    await supabase.from('credit_notes').delete().eq('id',id);
    showToast('CN/FOC deleted'); await fetchAll(); setSaving(false);
  };

  const deleteBizExp = async (id) => {
    setSaving(true);
    await supabase.from('business_expenses').delete().eq('id',id);
    showToast('Expense deleted'); await fetchAll(); setSaving(false);
  };

  const deletePipeline = async (id) => {
    setSaving(true);
    await supabase.from('pipeline_orders').delete().eq('id',id);
    showToast('Pipeline entry deleted'); await fetchAll(); setSaving(false);
  };

  const deleteCashTxn = async (id) => {
    setSaving(true);
    await supabase.from('cash_transactions').delete().eq('id',id);
    showToast('Transaction deleted'); await fetchAll(); setSaving(false);
  };

  const deleteMfrCN = async (id) => {
    const linked = mfrExp.filter(e=>e.mfr_cn_id===id);
    if (linked.length>0) { showToast(`⛔ Cannot delete — ${linked.length} expense(s) booked against this CN. Remove expenses first.`); return; }
    setSaving(true);
    await supabase.from('manufacturer_cns').delete().eq('id',id);
    showToast('Manufacturer CN deleted'); await fetchAll(); setSaving(false);
  };

  const deleteMfrExp = async (id) => {
    setSaving(true);
    await supabase.from('manufacturer_cn_expenses').delete().eq('id',id);
    showToast('Expense deleted'); await fetchAll(); setSaving(false);
  };

  const openEditPO = p => {
    setEditForm({
      po_id:p.id, customer_id:String(p.customer_id), delivery_type:p.delivery_type,
      qty:String(p.qty), unit_price:String(p.unit_price), purchase_price:String(p.purchase_price),
      vendor_name:p.vendor_name||'', vendor_invoice_no:p.vendor_invoice_no||'',
      purchase_date:p.purchase_date||'', advance:String(p.advance),
      po_date:p.po_date||'', status:p.status,
      invoice_no:p.invoice_no||'', invoice_date:p.invoice_date||'', dispatch_date:p.dispatch_date||'',
    });
    setEditPO(p);
  };

  const saveEditPO = async () => {
    if (!editForm.qty||!editForm.unit_price||!editForm.purchase_price||!editForm.advance||!editForm.po_date) { showToast('Fill all required fields'); return; }
    setSaving(true);
    const {error}=await supabase.from('purchase_orders').update({
      customer_id:Number(editForm.customer_id), delivery_type:editForm.delivery_type,
      qty:Number(editForm.qty), unit_price:Number(editForm.unit_price),
      purchase_price:Number(editForm.purchase_price),
      vendor_name:editForm.vendor_name||'Primary Manufacturer',
      vendor_invoice_no:editForm.vendor_invoice_no||null,
      purchase_date:editForm.purchase_date||null,
      advance:Number(editForm.advance), po_date:editForm.po_date, status:editForm.status,
      invoice_no:editForm.invoice_no||null, invoice_date:editForm.invoice_date||null,
      dispatch_date:editForm.dispatch_date||null,
    }).eq('id',editPO.id);
    if (error) showToast('Error: '+error.message);
    else { showToast('PO updated ✓'); setEditPO(null); await fetchAll(); }
    setSaving(false);
  };

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3500); };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [r1,r2,r3,r4,r5,r6,r7,r8,r9,r10,r11,r12,r13,r14,r15] = await Promise.all([
      supabase.from('customers').select('*').order('id'),
      supabase.from('purchase_orders').select('*').order('created_at'),
      supabase.from('credit_notes').select('*').order('created_at'),
      supabase.from('settings').select('*'),
      supabase.from('manufacturer_cns').select('*').order('cn_date',{ascending:false}),
      supabase.from('manufacturer_cn_expenses').select('*').order('expense_date',{ascending:false}),
      supabase.from('annual_targets').select('*').order('fy_start',{ascending:false}),
      supabase.from('pipeline_orders').select('*').order('expected_date'),
      supabase.from('cash_transactions').select('*').order('txn_date',{ascending:false}),
      supabase.from('business_expenses').select('*').order('expense_date',{ascending:false}),
      supabase.from('vendors').select('*').order('name'),
      supabase.from('delivery_entries').select('*').order('delivery_date',{ascending:false}),
      supabase.from('proforma_invoices').select('*').order('pi_date',{ascending:false}),
      supabase.from('delivery_sites').select('*').order('created_at'),
      supabase.from('payment_receipts').select('*').order('receipt_date',{ascending:false}),
    ]);
    setCust(r1.data||[]);  setPos(r2.data||[]);  setCns(r3.data||[]);
    setMfrCNs(r5.data||[]); setMfrExp(r6.data||[]);
    setTargets(r7.data||[]); setPipeline(r8.data||[]);
    setCashTxns(r9.data||[]); setBizExp(r10.data||[]);
    setVendors(r11.data||[]); setDeliveries(r12.data||[]);
    setPIs(r13.data||[]); setSites(r14.data||[]); setReceipts(r15.data||[]);
    if (r4.data) {
      const p={}; r4.data.forEach(r=>{ p[r.key]=Number(r.value); });
      setSettings(p);
      setSettingsForm({exw:p.default_purchase_price_exw,ddp:p.default_purchase_price_ddp,gst_rate:p.gst_rate_sales||12});
      setPoForm(blankPO(p));
    }
    setLoading(false);
  // eslint-disable-next-line
  },[]);

  useEffect(()=>{ fetchAll(); },[fetchAll]);

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const nextPONumber = useCallback(() => {
    const fy = targets.find(t=>t.fy_label===selectedFY) || targets[0];
    const fyShort = fy ? fy.fy_label.replace('FY ','').replace('-','-').split('-').map((y,i)=>i===0?y.slice(2):y.slice(2)).join('-') : '25-26';
    const existing = pos.filter(p=>p.id&&p.id.startsWith(COMPANY.poPrefix)).map(p=>{
      const parts = p.id.split('/');
      return parseInt(parts[2])||0;
    });
    const maxNum = existing.length>0 ? Math.max(...existing) : 0;
    const next = String(maxNum+1).padStart(4,'0');
    return `${COMPANY.poPrefix}${next}/${fyShort}`;
  },[pos,targets,selectedFY]);


  const addCustomer = async () => {
    if (!custForm.name) return; setSaving(true);
    const {error}=await supabase.from('customers').insert([custForm]);
    if (error) showToast('Error: '+(error.message.includes('duplicate')||error.message.includes('unique')?`Customer code "${custForm.customer_code}" already exists`:error.message));
    else { showToast('Customer added ✓'); setCustForm({customer_code:'',name:'',gstin:'',contact_name:'',phone:'',email:'',address:''}); await fetchAll(); }
    setSaving(false);
  };

  const addVendor = async () => {
    if (!vendorForm.name) { showToast('Enter vendor name'); return; }
    setSaving(true);
    const {error}=await supabase.from('vendors').insert([vendorForm]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Vendor added ✓'); setVendorForm({name:'',vendor_type:'Manufacturer',gstin:'',contact_name:'',phone:'',email:'',address:'',notes:''}); await fetchAll(); }
    setSaving(false);
  };

  const deleteVendor = async (id) => {
    setSaving(true);
    await supabase.from('vendors').delete().eq('id',id);
    showToast('Vendor deleted'); await fetchAll(); setSaving(false);
  };

  const addDelivery = async () => {
    if (!deliveryForm.po_id||!deliveryForm.delivery_date||!deliveryForm.qty_delivered) { showToast('Fill all required fields'); return; }
    const po = pos.find(p=>p.id===deliveryForm.po_id);
    const alreadyDelivered = deliveries.filter(d=>d.po_id===deliveryForm.po_id).reduce((s,d)=>s+d.qty_delivered,0);
    const remaining = (po?.qty||0) - alreadyDelivered;
    if (Number(deliveryForm.qty_delivered) > remaining) { showToast(`⛔ Cannot deliver ${deliveryForm.qty_delivered} — only ${remaining} units remaining`); return; }
    setSaving(true);
    const {error}=await supabase.from('delivery_entries').insert([{
      po_id:deliveryForm.po_id, delivery_date:deliveryForm.delivery_date,
      qty_delivered:Number(deliveryForm.qty_delivered), notes:deliveryForm.notes
    }]);
    // Update delivered_qty on PO
    if (!error) {
      const newDelivered = alreadyDelivered + Number(deliveryForm.qty_delivered);
      await supabase.from('purchase_orders').update({
        delivered_qty: newDelivered,
        status: newDelivered >= (po?.qty||0) ? 'Delivered / Fulfilled' : po?.status
      }).eq('id',deliveryForm.po_id);
    }
    if (error) showToast('Error: '+error.message);
    else { showToast('Delivery logged ✓'); setDeliveryForm({po_id:'',delivery_date:'',qty_delivered:'',notes:''}); await fetchAll(); }
    setSaving(false);
  };

  const deleteDelivery = async (id, po_id, qty) => {
    setSaving(true);
    await supabase.from('delivery_entries').delete().eq('id',id);
    // Recalculate delivered_qty
    const remaining = deliveries.filter(d=>d.id!==id&&d.po_id===po_id).reduce((s,d)=>s+d.qty_delivered,0);
    await supabase.from('purchase_orders').update({delivered_qty:remaining}).eq('id',po_id);
    showToast('Delivery entry deleted'); await fetchAll(); setSaving(false);
  };

  const addPO = async () => {
    if (!poForm.po_id||!poForm.customer_id||!poForm.qty||!poForm.unit_price||!poForm.purchase_price||!poForm.advance||!poForm.po_date) { showToast('Fill all required fields including PO Number'); return; }
    setSaving(true);
    const discAmt = Number(poForm.discount_amount||0);
    const discPct = Number(poForm.discount_pct||0);
    const vendor = vendors.find(v=>v.id===Number(poForm.vendor_id));
    const {error}=await supabase.from('purchase_orders').insert([{
      id:poForm.po_id.trim(), customer_id:Number(poForm.customer_id),
      delivery_type:poForm.delivery_type, qty:Number(poForm.qty),
      unit_price:Number(poForm.unit_price), discount_amount:discAmt, discount_pct:discPct,
      purchase_price:Number(poForm.purchase_price),
      vendor_name:vendor?.name||poForm.vendor_name||'Primary Manufacturer',
      vendor_invoice_no:poForm.vendor_invoice_no, purchase_date:poForm.purchase_date||null,
      advance:Number(poForm.advance), po_date:poForm.po_date, status:poForm.status,
      invoice_no:poForm.invoice_no||null, invoice_date:poForm.invoice_date||null,
      dispatch_date:poForm.dispatch_date||null, delivered_qty:0
    }]);
    if (error) showToast('Error: '+(error.message.includes('duplicate')?`PO Number "${poForm.po_id}" already exists`:error.message));
    else { showToast('PO added ✓'); setPoForm(blankPO(settings)); await fetchAll(); }
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

  const addMfrExpense = async () => {
    if (!expForm.mfr_cn_id||!expForm.expense_name||!expForm.expense_date||!expForm.amount) { showToast('Fill required fields'); return; }
    setSaving(true);
    const amt=Number(expForm.amount),gst=Number(expForm.gst_rate||0);
    const gstAmt=parseFloat((amt*gst/100).toFixed(2)),total=parseFloat((amt+gstAmt).toFixed(2));
    const {error}=await supabase.from('manufacturer_cn_expenses').insert([{mfr_cn_id:Number(expForm.mfr_cn_id),expense_name:expForm.expense_name,expense_date:expForm.expense_date,amount:amt,gst_rate:gst,gst_amount:gstAmt,total_amount:total,vendor_name:expForm.vendor_name,invoice_ref:expForm.invoice_ref,notes:expForm.notes}]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Expense booked ✓'); setExpForm({mfr_cn_id:expForm.mfr_cn_id,expense_name:'',expense_date:'',amount:'',gst_rate:'18',vendor_name:'',invoice_ref:'',notes:''}); await fetchAll(); }
    setSaving(false);
  };

  const addBizExpense = async () => {
    if (!bizExpForm.expense_date||!bizExpForm.description||!bizExpForm.amount||!bizExpForm.category) { showToast('Fill required fields'); return; }
    setSaving(true);
    const amt=Number(bizExpForm.amount), gst=Number(bizExpForm.gst_rate||0);
    const gstAmt=parseFloat((amt*gst/100).toFixed(2)), total=parseFloat((amt+gstAmt).toFixed(2));
    const {error}=await supabase.from('business_expenses').insert([{
      expense_date:bizExpForm.expense_date, category:bizExpForm.category,
      description:bizExpForm.description, vendor_name:bizExpForm.vendor_name,
      invoice_ref:bizExpForm.invoice_ref, amount:amt, gst_rate:gst,
      gst_amount:gstAmt, total_amount:total,
      is_gst_claimable:bizExpForm.is_gst_claimable,
      payment_mode:bizExpForm.payment_mode, notes:bizExpForm.notes,
    }]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Expense added ✓'); setBizExpForm({expense_date:'',category:'Rent',description:'',vendor_name:'',invoice_ref:'',amount:'',gst_rate:'0',is_gst_claimable:true,payment_mode:'Bank Transfer',notes:''}); await fetchAll(); }
    setSaving(false);
  };

  const addPipeline = async () => {
    if (!pipeForm.customer_id||!pipeForm.expected_qty||!pipeForm.expected_date) { showToast('Fill required fields'); return; }
    setSaving(true);
    const {error}=await supabase.from('pipeline_orders').insert([{customer_id:Number(pipeForm.customer_id),expected_qty:Number(pipeForm.expected_qty),expected_value:Number(pipeForm.expected_value||0),expected_date:pipeForm.expected_date,delivery_type:pipeForm.delivery_type,probability:Number(pipeForm.probability||50),notes:pipeForm.notes,status:pipeForm.status}]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Added ✓'); setPipeForm({customer_id:'',expected_qty:'',expected_value:'',expected_date:'',delivery_type:'DDP',probability:'75',notes:'',status:'Active'}); await fetchAll(); }
    setSaving(false);
  };
  const updatePipelineStatus = async (id,s) => { await supabase.from('pipeline_orders').update({status:s}).eq('id',id); await fetchAll(); };

  const addCashTxn = async () => {
    if (!cashForm.txn_date||!cashForm.amount) { showToast('Fill required fields'); return; }
    setSaving(true);
    const {error}=await supabase.from('cash_transactions').insert([{txn_date:cashForm.txn_date,txn_type:cashForm.txn_type,category:cashForm.category,amount:Number(cashForm.amount),reference_po:cashForm.reference_po||null,description:cashForm.description}]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Transaction added ✓'); setCashForm({txn_date:'',txn_type:'Cash In',category:'Balance Receipt',amount:'',reference_po:'',description:''}); await fetchAll(); }
    setSaving(false);
  };

  const saveSettings = async () => {
    if (!settingsForm.exw||!settingsForm.ddp||!settingsForm.gst_rate) return;
    setSaving(true);
    const {error}=await supabase.from('settings').upsert([
      {key:'default_purchase_price_exw',value:String(settingsForm.exw),label:'EXW',updated_at:new Date().toISOString()},
      {key:'default_purchase_price_ddp',value:String(settingsForm.ddp),label:'DDP',updated_at:new Date().toISOString()},
      {key:'gst_rate_sales',value:String(settingsForm.gst_rate),label:'GST Rate on Sales (%)',updated_at:new Date().toISOString()},
    ],{onConflict:'key'});
    if (error) showToast('Error: '+error.message);
    else { showToast('Settings saved ✓'); await fetchAll(); }
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

  // ── Proforma Invoice CRUD ─────────────────────────────────────────────────
  const nextPINumber = useCallback(() => {
    const existing = pis.map(p=>{ const m=p.pi_number?.match(/\/(\d+)\//); return m?parseInt(m[1]):0; });
    const maxNum = existing.length>0?Math.max(...existing):0;
    const fy = targets.find(t=>t.fy_label===selectedFY)||targets[0];
    const fyShort = fy?fy.fy_label.replace('FY ','').split('-').map(y=>y.slice(2)).join('-'):'25-26';
    return `${COMPANY.short}/PI/${String(maxNum+1).padStart(4,'0')}/${fyShort}`;
  },[pis,targets,selectedFY]);

  const addPI = async () => {
    if (!piForm.pi_number||!piForm.customer_id||!piForm.pi_date||!piForm.total_amount) { showToast('Fill PI number, customer, date, total amount'); return; }
    setSaving(true);
    const {error}=await supabase.from('proforma_invoices').insert([{
      pi_number:piForm.pi_number.trim(), po_id:piForm.po_id||null,
      customer_id:Number(piForm.customer_id), pi_date:piForm.pi_date,
      amount:Number(piForm.amount||0), gst_amount:Number(piForm.gst_amount||0),
      total_amount:Number(piForm.total_amount), advance_due:Number(piForm.advance_due||piForm.total_amount),
      advance_received:Number(piForm.advance_received||0), advance_date:piForm.advance_date||null,
      payment_terms:piForm.payment_terms, status:piForm.status, notes:piForm.notes
    }]);
    if (error) showToast('Error: '+error.message);
    else { showToast('PI added ✓'); setPiForm({pi_number:'',po_id:'',customer_id:'',pi_date:'',amount:'',gst_amount:'',total_amount:'',advance_due:'',advance_received:'',advance_date:'',payment_terms:'100% Advance against PI',status:'Pending',notes:''}); await fetchAll(); }
    setSaving(false);
  };

  const updatePIField = async (id, field, value) => {
    const updates = {[field]: value};
    // Auto-update status based on amounts
    if (field==='advance_received') {
      const pi = pis.find(p=>p.id===id);
      if (pi) {
        const received = Number(value);
        const due = Number(pi.advance_due);
        updates.status = received<=0?'Pending':received>=due?'Paid':'Partially Paid';
      }
    }
    await supabase.from('proforma_invoices').update(updates).eq('id',id);
    await fetchAll();
  };

  const deletePI = async (id) => {
    setSaving(true);
    await supabase.from('proforma_invoices').delete().eq('id',id);
    showToast('PI deleted'); await fetchAll(); setSaving(false);
  };

  // ── Delivery Sites CRUD ───────────────────────────────────────────────────
  const addSite = async () => {
    if (!siteForm.po_id||!siteForm.site_name||!siteForm.qty) { showToast('Fill PO, site name and qty'); return; }
    // Validate total qty
    const po = pos.find(p=>p.id===siteForm.po_id);
    const existingSiteQty = sites.filter(s=>s.po_id===siteForm.po_id).reduce((s,x)=>s+x.qty,0);
    if (existingSiteQty+Number(siteForm.qty)>Number(po?.qty||0)) { showToast(`⛔ Total site qty (${existingSiteQty+Number(siteForm.qty)}) exceeds PO qty (${po?.qty})`); return; }
    setSaving(true);
    const {error}=await supabase.from('delivery_sites').insert([{...siteForm,qty:Number(siteForm.qty)}]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Delivery site added ✓'); setSiteForm({po_id:'',site_name:'',address:'',gstin:'',contact_name:'',phone:'',qty:'',notes:''}); await fetchAll(); }
    setSaving(false);
  };

  const deleteSite = async (id) => {
    setSaving(true);
    await supabase.from('delivery_sites').delete().eq('id',id);
    showToast('Site removed'); await fetchAll(); setSaving(false);
  };

  // ── Payment Receipts CRUD ─────────────────────────────────────────────────
  const addReceipt = async () => {
    if (!receiptForm.customer_id||!receiptForm.receipt_date||!receiptForm.amount) { showToast('Fill customer, date and amount'); return; }
    setSaving(true);
    const {error}=await supabase.from('payment_receipts').insert([{
      receipt_no:receiptForm.receipt_no||null, customer_id:Number(receiptForm.customer_id),
      po_id:receiptForm.po_id||null, receipt_date:receiptForm.receipt_date,
      amount:Number(receiptForm.amount), payment_mode:receiptForm.payment_mode,
      reference:receiptForm.reference||null, notes:receiptForm.notes||null
    }]);
    if (error) showToast('Error: '+error.message);
    else { showToast('Receipt logged ✓'); setReceiptForm({receipt_no:'',customer_id:'',po_id:'',receipt_date:'',amount:'',payment_mode:'Bank Transfer',reference:'',notes:''}); await fetchAll(); }
    setSaving(false);
  };

  const deleteReceipt = async (id) => {
    setSaving(true);
    await supabase.from('payment_receipts').delete().eq('id',id);
    showToast('Receipt deleted'); await fetchAll(); setSaving(false);
  };

  // ── Per-PO financial helper (based on DELIVERED qty) ─────────────────────
  // deliveredQty = sum of all delivery_entries for that PO
  // invoicedAmt  = deliveredQty × unit_price − discount_prorated + GST
  // balanceDue   = invoicedAmt − advance (floor 0)
  const poFinancials = useCallback((p) => {
    const deliveredQty = deliveries.filter(d=>d.po_id===p.id).reduce((s,d)=>s+d.qty_delivered, 0);
    const orderedQty   = p.qty || 0;
    const unitPrice    = Number(p.unit_price) || 0;
    const discountAmt  = Number(p.discount_amount) || 0;
    const gstRate      = settings.gst_rate_sales || 12;
    const advance      = Number(p.advance) || 0;

    // Gross ordered
    const orderedGross = orderedQty * unitPrice;
    // Pro-rata discount on delivered portion
    const discountDelivered = orderedGross > 0 ? (deliveredQty / orderedQty) * discountAmt : 0;
    const deliveredGross    = deliveredQty * unitPrice;
    const deliveredNetTax   = deliveredGross - discountDelivered;
    const deliveredGst      = deliveredNetTax * (gstRate / 100);
    const invoicedAmt       = deliveredNetTax + deliveredGst;
    const balanceDue        = Math.max(0, invoicedAmt - advance);

    // Full order values (for reference / ordered column)
    const orderedDiscount   = discountAmt;
    const orderedNetTax     = orderedGross - orderedDiscount;
    const orderedGst        = orderedNetTax * (gstRate / 100);
    const orderedTotal      = orderedNetTax + orderedGst;
    const balQty            = orderedQty - deliveredQty;

    return { deliveredQty, orderedQty, balQty, unitPrice, orderedGross, orderedDiscount, orderedNetTax, orderedGst, orderedTotal, deliveredGross, discountDelivered, deliveredNetTax, deliveredGst, invoicedAmt, advance, balanceDue };
  }, [deliveries, settings]);


  const analytics = useMemo(()=>{
    const totalSalesGross  = pos.reduce((s,p)=>s+p.qty*p.unit_price,0);
    const totalUnits       = pos.reduce((s,p)=>s+p.qty,0);
    const totalAdvances    = pos.reduce((s,p)=>s+Number(p.advance),0);
    const totalCNValue     = cns.filter(c=>c.type==='CNNote').reduce((s,c)=>s+Number(c.amount),0);
    const totalFOCCost     = cns.filter(c=>c.type==='FOC').reduce((s,c)=>{ const po=pos.find(p=>p.id===c.po_id); return s+c.foc_units*Number(po?.purchase_price||0); },0);
    const totalNetSales    = totalSalesGross-totalCNValue;
    const totalPurchCost   = pos.reduce((s,p)=>s+p.qty*Number(p.purchase_price),0)+totalFOCCost;
    const totalBizExp      = bizExp.reduce((s,e)=>s+Number(e.total_amount),0);
    const totalProfit      = totalNetSales-totalPurchCost-totalBizExp;
    const pendingAdvance   = pos.filter(p=>p.status!=='Delivered / Fulfilled').reduce((s,p)=>s+poFinancials(p).balanceDue,0);
    const avgSP            = totalUnits>0?totalNetSales/totalUnits:0;
    const unfulfilled      = pos.filter(p=>p.status!=='Delivered / Fulfilled');

    const perCustomer = customers.map(cust=>{
      const cPOs=pos.filter(p=>p.customer_id===cust.id);
      // Pool ALL CNs for this customer by customer_id — regardless of which PO they are linked to
      const cCNs=cns.filter(c=>c.customer_id===cust.id);
      const grossSales=cPOs.reduce((s,p)=>s+p.qty*p.unit_price,0);
      const totalQty=cPOs.reduce((s,p)=>s+p.qty,0);
      // CN value: sum all credit notes at customer level
      const cnVal=cCNs.filter(c=>c.type==='CNNote').reduce((s,c)=>s+Number(c.amount),0);
      // FOC: units and cost — use linked PO purchase price for cost
      const focUnits=cCNs.filter(c=>c.type==='FOC').reduce((s,c)=>s+c.foc_units,0);
      const focCost=cCNs.filter(c=>c.type==='FOC').reduce((s,c)=>{ const po=pos.find(p=>p.id===c.po_id); return s+c.foc_units*Number(po?.purchase_price||0); },0);
      const netSales=grossSales-cnVal, purchCost=cPOs.reduce((s,p)=>s+p.qty*Number(p.purchase_price),0)+focCost;
      const profit=netSales-purchCost;
      // Avg SP = net sales ÷ invoiced units (CNs reduce numerator, not denominator)
      const avgSP2=totalQty>0?netSales/totalQty:0;
      // Avg PP = total purchase cost ÷ (invoiced units + FOC units)
      const avgPP=(totalQty+focUnits)>0?purchCost/(totalQty+focUnits):0;
      const margin=netSales>0?(profit/netSales)*100:0;
      const advance=cPOs.reduce((s,p)=>s+Number(p.advance),0);
      // Pending balance based on delivered qty
      const pending=cPOs.filter(p=>p.status!=='Delivered / Fulfilled').reduce((s,p)=>s+poFinancials(p).balanceDue,0);
      return {...cust,grossSales,totalQty,cnVal,focUnits,focCost,netSales,purchCost,profit,avgSP:avgSP2,avgPP,margin,advance,pending,atRisk:totalQty>0&&avgSP2<avgPP};
    });

    return {totalSalesGross,totalUnits,totalAdvances,totalCNValue,totalFOCCost,totalNetSales,totalPurchCost,totalBizExp,totalProfit,pendingAdvance,avgSP,perCustomer,unfulfilled};
  },[customers,pos,cns,bizExp,poFinancials]);

  // ── Biz expense analytics ─────────────────────────────────────────────────
  const bizExpAnalytics = useMemo(()=>{
    const total     = bizExp.reduce((s,e)=>s+Number(e.total_amount),0);
    const totalBase = bizExp.reduce((s,e)=>s+Number(e.amount),0);
    const totalGST  = bizExp.reduce((s,e)=>s+Number(e.gst_amount),0);
    const byCat     = EXP_CATS.reduce((acc,cat)=>{ acc[cat]=bizExp.filter(e=>e.category===cat).reduce((s,e)=>s+Number(e.total_amount),0); return acc; },{});
    const filtered  = expCatFilter==='All'?bizExp:bizExp.filter(e=>e.category===expCatFilter);
    return {total,totalBase,totalGST,byCat,filtered};
  },[bizExp,expCatFilter]);

  // ── Cash Flow ─────────────────────────────────────────────────────────────
  const cashAnalytics = useMemo(()=>{
    const fy=targets.find(t=>t.fy_label===selectedFY)||targets[0];
    if (!fy) return null;
    const fyMonths=FY_MONTHS(fy.fy_label);
    const today=new Date();
    const mkDate=d=>d30=>{ const x=new Date(today); x.setDate(x.getDate()+d30); return x; };
    const d30=mkDate(30)(), d60=mkDate(60)(), d90=mkDate(90)();

    const monthly=fyMonths.map(m=>{
      const advancesIn=pos.filter(p=>p.po_date>=m.start&&p.po_date<=m.end).reduce((s,p)=>s+Number(p.advance),0);
      const txnIn=cashTxns.filter(t=>t.txn_date>=m.start&&t.txn_date<=m.end&&t.txn_type==='Cash In').reduce((s,t)=>s+Number(t.amount),0);
      const txnOut=cashTxns.filter(t=>t.txn_date>=m.start&&t.txn_date<=m.end&&t.txn_type==='Cash Out').reduce((s,t)=>s+Number(t.amount),0);
      const mfrPay=pos.filter(p=>p.purchase_date>=m.start&&p.purchase_date<=m.end).reduce((s,p)=>s+p.qty*Number(p.purchase_price),0);
      const mfrExp2=mfrExp.filter(e=>e.expense_date>=m.start&&e.expense_date<=m.end).reduce((s,e)=>s+Number(e.total_amount),0);
      const bizExpOut=bizExp.filter(e=>e.expense_date>=m.start&&e.expense_date<=m.end).reduce((s,e)=>s+Number(e.total_amount),0);
      const totalIn=advancesIn+txnIn, totalOut=mfrPay+txnOut+mfrExp2+bizExpOut;
      return {label:m.label,cashIn:totalIn,cashOut:totalOut,net:totalIn-totalOut,advancesIn,txnIn,mfrPay,mfrExp2,bizExpOut,txnOut};
    });

    const totalIn=monthly.reduce((s,m)=>s+m.cashIn,0);
    const totalOut=monthly.reduce((s,m)=>s+m.cashOut,0);
    const f=(d)=>pipeline.filter(p=>p.status==='Active'&&new Date(p.expected_date)<=d).reduce((s,p)=>s+(p.expected_value||p.expected_qty*(p.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw))*p.probability/100,0);
    return {monthly,totalIn,totalOut,netCF:totalIn-totalOut,expectedInflows:analytics.pendingAdvance,forecast30:f(d30),forecast60:f(d60),forecast90:f(d90),fy};
  },[pos,cashTxns,mfrExp,bizExp,pipeline,targets,selectedFY,settings,analytics]);

  // ── GST analytics (rate from Settings) ───────────────────────────────────
  const gstAnalytics = useMemo(()=>{
    const fy=targets.find(t=>t.fy_label===selectedFY)||targets[0];
    if (!fy) return null;
    const rate=(settings.gst_rate_sales||12)/100;
    const fyMonths=FY_MONTHS(fy.fy_label);

    const monthly=fyMonths.map(m=>{
      const mPos=pos.filter(p=>p.po_date>=m.start&&p.po_date<=m.end);
      const outputGST=mPos.reduce((s,p)=>s+p.qty*p.unit_price,0)*rate;
      const inputGSTPurch=mPos.reduce((s,p)=>s+p.qty*Number(p.purchase_price),0)*rate;
      const inputGSTMfrExp=mfrExp.filter(e=>e.expense_date>=m.start&&e.expense_date<=m.end).reduce((s,e)=>s+Number(e.gst_amount),0);
      const inputGSTBizExp=bizExp.filter(e=>e.expense_date>=m.start&&e.expense_date<=m.end&&e.is_gst_claimable).reduce((s,e)=>s+Number(e.gst_amount),0);
      const totalInput=inputGSTPurch+inputGSTMfrExp+inputGSTBizExp;
      return {label:m.label,outputGST,inputGSTPurch,inputGSTMfrExp,inputGSTBizExp,totalInput,netGST:outputGST-totalInput};
    });

    const tOut=monthly.reduce((s,m)=>s+m.outputGST,0);
    const tIn=monthly.reduce((s,m)=>s+m.totalInput,0);
    return {monthly,tOut,tIn,tNet:tOut-tIn,ratePct:(rate*100).toFixed(0)+'%'};
  },[pos,mfrExp,bizExp,targets,selectedFY,settings]);

  // ── Aging ────────────────────────────────────────────────────────────────
  const agingAnalytics = useMemo(()=>{
    const today=new Date();
    const aged=pos.filter(p=>p.status!=='Delivered / Fulfilled').map(p=>{
      const bal=Math.max(0,p.qty*p.unit_price-p.advance);
      const days=Math.floor((today-new Date(p.po_date))/(1000*86400));
      const bucket=days<=30?'0-30':days<=60?'31-60':days<=90?'61-90':'90+';
      return {...p,bal,days,bucket,custName:customers.find(c=>c.id===p.customer_id)?.name||'—'};
    }).filter(p=>p.bal>0);
    const buckets={'0-30':0,'31-60':0,'61-90':0,'90+':0};
    aged.forEach(p=>{ buckets[p.bucket]=(buckets[p.bucket]||0)+p.bal; });
    return {aged,buckets,total:aged.reduce((s,p)=>s+p.bal,0)};
  },[pos,customers]);

  // ── Target vs Actual ─────────────────────────────────────────────────────
  const targetAnalytics = useMemo(()=>{
    const fy=targets.find(t=>t.fy_label===selectedFY)||targets[0];
    if (!fy) return null;
    const fyPos=pos.filter(p=>p.po_date>=fy.fy_start&&p.po_date<=fy.fy_end);
    const fyCNs=cns.filter(c=>{ const po=pos.find(p=>p.id===c.po_id); return po&&po.po_date>=fy.fy_start&&po.po_date<=fy.fy_end; });
    const actualUnits=fyPos.reduce((s,p)=>s+p.qty,0);
    const actualGross=fyPos.reduce((s,p)=>s+p.qty*p.unit_price,0);
    const actualCN=fyCNs.filter(c=>c.type==='CNNote').reduce((s,c)=>s+Number(c.amount),0);
    const actualFOCCost=fyCNs.filter(c=>c.type==='FOC').reduce((s,c)=>{ const po=pos.find(p=>p.id===c.po_id); return s+c.foc_units*Number(po?.purchase_price||0); },0);
    const actualNet=actualGross-actualCN;
    const actualCost=fyPos.reduce((s,p)=>s+p.qty*Number(p.purchase_price),0)+actualFOCCost;
    const fyBizExp=bizExp.filter(e=>e.expense_date>=fy.fy_start&&e.expense_date<=fy.fy_end).reduce((s,e)=>s+Number(e.total_amount),0);
    const actualProfit=actualNet-actualCost-fyBizExp;
    const monthly=FY_MONTHS(fy.fy_label).map(m=>({label:m.label,units:fyPos.filter(p=>p.po_date>=m.start&&p.po_date<=m.end).reduce((s,p)=>s+p.qty,0),value:fyPos.filter(p=>p.po_date>=m.start&&p.po_date<=m.end).reduce((s,p)=>s+p.qty*p.unit_price,0)}));
    const el=monthly.filter(m=>m.units>0).length||1;
    const slab1Hit=fy.mfr_slab_1_units>0&&actualUnits>=fy.mfr_slab_1_units;
    const slab2Hit=fy.mfr_slab_2_units>0&&actualUnits>=fy.mfr_slab_2_units;
    return {fy,actualUnits,actualNet,actualCost,actualProfit,monthly,runRateUnits:(actualUnits/el)*12,runRateValue:(actualNet/el)*12,slab1Hit,slab2Hit,unitsToSlab1:Math.max(0,fy.mfr_slab_1_units-actualUnits),unitsToSlab2:Math.max(0,fy.mfr_slab_2_units-actualUnits)};
  },[targets,pos,cns,bizExp,selectedFY]);

  // ── Pipeline ──────────────────────────────────────────────────────────────
  const pipeAnalytics = useMemo(()=>{
    const active=pipeline.filter(p=>p.status==='Active');
    const totalExpUnits=active.reduce((s,p)=>s+p.expected_qty,0);
    const totalExpValue=active.reduce((s,p)=>s+(p.expected_value||p.expected_qty*settings.default_purchase_price_ddp),0);
    const weightedValue=active.reduce((s,p)=>s+(p.expected_value||p.expected_qty*settings.default_purchase_price_ddp)*p.probability/100,0);
    return {active,totalExpUnits,totalExpValue,weightedValue};
  },[pipeline,settings]);

  // ── Mfr CN ────────────────────────────────────────────────────────────────
  const mfrCNAnalytics = useMemo(()=>mfrCNs.map(cn=>{
    const expenses=mfrExp.filter(e=>e.mfr_cn_id===cn.id);
    const totalUsed=expenses.reduce((s,e)=>s+Number(e.total_amount),0);
    return {...cn,expenses,totalUsed,balance:Number(cn.total_value)-totalUsed};
  }),[mfrCNs,mfrExp]);

  // ── Simulator ─────────────────────────────────────────────────────────────
  const simResult = useMemo(()=>{
    if (!sim.customerId) return null;
    const cust=analytics.perCustomer.find(c=>c.id===Number(sim.customerId)); if (!cust) return null;
    // cust already has CNs pooled at customer level from perCustomer analytics
    const eC=Number(sim.extraCN||0),eF=Number(sim.extraFOC||0);
    const nq=Number(sim.newPoQty||0),nup=Number(sim.newPoUnitPrice||0),npp=Number(sim.newPoPurchasePrice||settings.default_purchase_price_ddp);
    const nCN=Number(sim.newPoCNAmount||0),nFOC=Number(sim.newPoFOCUnits||0);
    const hasNew=nq>0&&nup>0;
    const cG=cust.grossSales+(hasNew?nq*nup:0), cCV=cust.cnVal+eC+nCN;
    const cFC=cust.focCost+eF*settings.default_purchase_price_ddp+nFOC*npp;
    const cPC=cust.purchCost-cust.focCost+(hasNew?nq*npp:0)+cFC;
    const cNS=cG-cCV, cP=cNS-cPC, cTQ=cust.totalQty+(hasNew?nq:0), cFU=cust.focUnits+eF+nFOC;
    const cASP=cTQ>0?cNS/cTQ:0, cAPP=(cTQ+cFU)>0?cPC/(cTQ+cFU):0, cM=cNS>0?(cP/cNS)*100:0;
    return {cust,hasNew,nq,nup,npp,nCN,nFOC,cNS,cPC,cP,cASP,cAPP,cM,cTQ,willLoss:cASP<cAPP,nPGP:hasNew?(nq*nup-nCN)-(nq*npp+nFOC*npp):0};
  },[sim,analytics,settings]);

  // ── Styles ────────────────────────────────────────────────────────────────
  const inp  = {width:'100%',background:'#08090f',border:'1px solid #1a1a2e',borderRadius:2,padding:'9px 12px',color:'#e8e8ed',fontSize:12,fontFamily:"'Noto Sans JP',sans-serif",outline:'none'};
  const lbl  = {display:'block',fontSize:9,fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.14em',color:'#3a3a5a',marginBottom:5};
  const card = {background:'#0d0e18',border:'1px solid #1a1a2e',borderRadius:4};
  const btn  = (d,bg='#c8a96e',tc='#08090f')=>({background:bg,color:tc,fontWeight:700,border:'none',borderRadius:2,padding:'10px 18px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:11,opacity:d?0.5:1,whiteSpace:'nowrap',letterSpacing:'.06em'});
  const g4   = {display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14};

  const navItems=[
    {key:'dashboard',  label:'📊 Overview'},
    {key:'cashflow',   label:'💰 Cash Flow'},
    {key:'target',     label:'🎯 Target'},
    {key:'aging',      label:'📅 Aging'},
    {key:'gst',        label:'🧾 GST'},
    {key:'pipeline',   label:'📦 Pipeline'},
    {key:'expenses',   label:'💸 Expenses'},
    {key:'unfulfilled',label:'⏳ Pending'},
    {key:'pos',        label:'📋 Orders'},
    {key:'deliveries', label:'🚚 Deliveries'},
    {key:'sites',      label:'📍 Sites'},
    {key:'cns',        label:'🔖 CN/FOC'},
    {key:'pi',         label:'📄 Proforma'},
    {key:'ledger',     label:'📒 Ledger'},
    {key:'customers',  label:'👤 Customers'},
    {key:'vendors',    label:'🏪 Vendors'},
    {key:'simulator',  label:'🔮 Simulator'},
    {key:'mfrcn',      label:'🏭 Mfr. CNs'},
    {key:'settings',   label:'⚙️ Settings'},
  ];

  const FYSelector = () => (
    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:18,flexWrap:'wrap'}}>
      <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace"}}>FY:</div>
      {targets.map(t=><button key={t.fy_label} onClick={()=>setFY(t.fy_label)} style={{background:selectedFY===t.fy_label?'#1e293b':'transparent',border:`1px solid ${selectedFY===t.fy_label?'#f59e0b':'#334155'}`,color:selectedFY===t.fy_label?'#f59e0b':'#64748b',borderRadius:6,padding:'3px 10px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:11}}>{t.fy_label}</button>)}
    </div>
  );

  const KPICard = ({label,val,sub,color}) => (
    <div className="kc">
      <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:8}}>{label}</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:22,fontWeight:500,color,lineHeight:1}}>{val}</div>
      {sub&&<div style={{fontSize:11,color:'#475569',marginTop:5}}>{sub}</div>}
    </div>
  );

  return (
    <div style={{fontFamily:"'Noto Sans JP','DM Sans','Segoe UI',sans-serif",background:'#08090f',minHeight:'100vh',color:'#e8e8ed'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:4px;height:4px;} ::-webkit-scrollbar-track{background:#08090f;} ::-webkit-scrollbar-thumb{background:#2a2a3a;border-radius:2px;}
        .kc{background:#0d0e18;border:1px solid #1a1a2e;border-radius:4px;padding:18px;transition:border-color .2s;}
        .kc:hover{border-color:#c8a96e;}
        .nb{background:transparent;border:none;cursor:pointer;padding:5px 10px;border-radius:2px;font-size:11px;font-family:'DM Mono',monospace;color:#5a5a7a;transition:all .15s;white-space:nowrap;letter-spacing:.04em;}
        .nb.active{background:#1a1a2e;color:#c8a96e;border-bottom:2px solid #c8a96e;}
        .nb:hover:not(.active){color:#e8e8ed;}
        table{width:100%;border-collapse:collapse;}
        th{font-size:9px;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.12em;color:#3a3a5a;padding:8px 12px;text-align:left;border-bottom:1px solid #1a1a2e;}
        td{font-size:12px;padding:8px 12px;border-bottom:1px solid #1a1a2e30;vertical-align:middle;}
        tr:hover td{background:#0d0e1880;}
        .sec{font-size:9px;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.16em;color:#3a3a5a;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid #1a1a2e;}
        select option{background:#0d0e18;}
        input:focus,select:focus{border-color:#c8a96e!important;outline:none;}
        .chip{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-family:'DM Mono',monospace;padding:2px 8px;border-radius:2px;border:1px solid;}
        .search-bar{width:100%;background:#08090f;border:1px solid #1a1a2e;border-radius:2px;padding:7px 12px;color:#e8e8ed;font-size:12px;font-family:'Noto Sans JP',sans-serif;outline:none;}
        .search-bar:focus{border-color:#c8a96e;}
        .search-bar::placeholder{color:#3a3a5a;}
      `}</style>

      {toast&&<div style={{position:'fixed',top:20,right:20,background:'#052e16',border:'1px solid #14532d',color:'#34d399',padding:'11px 18px',borderRadius:10,fontFamily:"'DM Mono',monospace",fontSize:12,zIndex:9999,boxShadow:'0 8px 24px rgba(0,0,0,.5)'}}>{toast}</div>}

      {/* ── Confirm Delete Modal ── */}
      {confirmDelete&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{background:'#0f172a',border:'1px solid #7f1d1d',borderRadius:16,padding:28,maxWidth:420,width:'100%',boxShadow:'0 24px 64px rgba(0,0,0,0.7)'}}>
            <div style={{fontSize:22,marginBottom:12,textAlign:'center'}}>🗑️</div>
            <div style={{fontFamily:"'DM Mono',monospace",color:'#f87171',fontSize:13,textAlign:'center',marginBottom:8}}>CONFIRM DELETE</div>
            <div style={{color:'#94a3b8',fontSize:13,textAlign:'center',marginBottom:20,lineHeight:1.6}}>
              Are you sure you want to permanently delete<br/>
              <strong style={{color:'#f1f5f9'}}>{confirmDelete.label}</strong>?<br/>
              <span style={{fontSize:11,color:'#64748b'}}>This cannot be undone.</span>
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setConfirmDelete(null)} style={{flex:1,background:'transparent',border:'1px solid #334155',color:'#94a3b8',borderRadius:8,padding:'10px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:12}}>Cancel</button>
              <button onClick={()=>{ confirmDelete.onConfirm(); setConfirmDelete(null); }} style={{flex:1,background:'#7f1d1d',border:'1px solid #f87171',color:'#fca5a5',borderRadius:8,padding:'10px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700}}>DELETE</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div style={{background:'#0d0e18',borderBottom:'1px solid #1a1a2e',padding:'0 16px'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,height:48,flexWrap:'nowrap',overflowX:'auto'}}>
          {/* Logo mark — minimalist red circle (Japanese torii inspired) */}
          <div style={{flexShrink:0,display:'flex',alignItems:'center',gap:8,paddingRight:12,borderRight:'1px solid #1a1a2e'}}>
            <div style={{width:24,height:24,borderRadius:'50%',background:'transparent',border:'2px solid #c8a96e',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:'#c8a96e'}}/>
            </div>
            <div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'#c8a96e',letterSpacing:'0.08em',fontWeight:500}}>{COMPANY.short}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:'#3a3a5a',letterSpacing:'0.06em'}}>INVERTER ERP</div>
            </div>
          </div>
          <div style={{display:'flex',gap:0,alignItems:'center',flexWrap:'nowrap'}}>
            {navItems.map(n=><button key={n.key} className={`nb ${view===n.key?'active':''}`} onClick={()=>setView(n.key)}>{n.label}</button>)}
          </div>
          <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center',flexShrink:0}}>
            <div style={{fontSize:9,color:'#3a3a5a',fontFamily:"'DM Mono',monospace"}}>{user?.email}</div>
            <button onClick={signOut} style={{background:'transparent',border:'1px solid #1a1a2e',color:'#3a3a5a',borderRadius:2,padding:'4px 8px',cursor:'pointer',fontSize:9,fontFamily:"'DM Mono',monospace",letterSpacing:'.06em'}}>SIGN OUT</button>
          </div>
        </div>
      </div>

      <div style={{padding:'20px',maxWidth:1600,margin:'0 auto'}}>
        {loading?<Spinner/>:(<>

        {/* ════ OVERVIEW ════ */}
        {view==='dashboard'&&(<div>
          <div style={{marginBottom:20,paddingBottom:14,borderBottom:'1px solid #1a1a2e'}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#3a3a5a',letterSpacing:'.16em',marginBottom:4}}>BASILSPHERE INNOVATIONS PRIVATE LIMITED</div>
            <div style={{fontFamily:"'Noto Sans JP',sans-serif",fontSize:20,fontWeight:300,color:'#e8e8ed',letterSpacing:'.02em'}}>Executive Overview</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:'#3a3a5a',marginTop:3}}>GSTIN: {COMPANY.gstin} · {COMPANY.address}</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
            <KPICard label="Gross Sales" val={fmtL(analytics.totalSalesGross)} sub={`${fmt(analytics.totalUnits)} units`} color="#f59e0b"/>
            <KPICard label="Net Sales" val={fmtL(analytics.totalNetSales)} sub={`After CNs: −${fmtL(analytics.totalCNValue)}`} color="#38bdf8"/>
            <KPICard label="Purchase Cost" val={fmtL(analytics.totalPurchCost)} sub={`FOC cost: ${fmtL(analytics.totalFOCCost)}`} color="#a78bfa"/>
            <KPICard label="Business Expenses" val={fmtL(analytics.totalBizExp)} sub="Salaries, rent, overheads" color="#fb923c"/>
            <KPICard label="Net Profit" val={fmtL(analytics.totalProfit)} sub={`Margin: ${pct((analytics.totalProfit/analytics.totalNetSales)*100)}`} color={analytics.totalProfit>=0?'#34d399':'#f87171'}/>
            <KPICard label="Advances Received" val={fmtL(analytics.totalAdvances)} sub="from customers" color="#34d399"/>
            <KPICard label="Pending Collections" val={fmtL(analytics.pendingAdvance)} sub="on open orders" color={analytics.pendingAdvance>0?'#f87171':'#34d399'}/>
            <KPICard label="Open Orders" val={fmt(analytics.unfulfilled.length)} sub="pending delivery" color="#f59e0b"/>
          </div>
          <div className="sec">Customer Profitability</div>
          <div style={{...card,overflow:'auto',marginBottom:16}}>
            <table>
              <thead><tr>{['Customer','Units','Gross','CN','Net Sales','Purchase Cost','Biz Exp Share','Profit','Margin','Avg SP','Avg PP','Pending','Alert'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{analytics.perCustomer.map(c=>(
                <tr key={c.id}>
                  <td style={{fontWeight:500}}>{c.name}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{c.totalQty}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(c.grossSales)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171'}}>{fmtL(c.cnVal)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#38bdf8'}}>{fmtL(c.netSales)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(c.purchCost)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#fb923c',fontSize:11}}>Pro-rated</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:c.profit>=0?'#34d399':'#f87171',fontWeight:600}}>{fmtL(c.profit)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:c.margin>=0?'#34d399':'#f87171'}}>{pct(c.margin)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtC(c.avgSP)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtC(c.avgPP)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:c.pending>0?'#f87171':'#34d399'}}>{fmtL(c.pending)}</td>
                  <td>{c.atRisk?<span className="chip" style={{background:'#450a0a',color:'#f87171',borderColor:'#7f1d1d'}}>⚠ RISK</span>:<span className="chip" style={{background:'#052e16',color:'#34d399',borderColor:'#14532d'}}>✓ OK</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {analytics.perCustomer.filter(c=>c.atRisk).map(c=><AlertBox key={c.id} msg={`${c.name} — Avg SP (${fmtC(c.avgSP)}) below Avg PP (${fmtC(c.avgPP)})`}/>)}
        </div>)}

        {/* ════ EXPENSES ════ */}
        {view==='expenses'&&(<div>
          <div className="sec">Business Expenses Ledger</div>

          {/* Summary KPIs */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:20}}>
            <KPICard label="Total Expenses (All Time)" val={fmtL(bizExpAnalytics.total)} sub={`Base: ${fmtL(bizExpAnalytics.totalBase)}`} color="#f87171"/>
            <KPICard label="GST on Expenses" val={fmtL(bizExpAnalytics.totalGST)} sub="Claimable as input credit" color="#34d399"/>
            <KPICard label="Net Cash Out" val={fmtL(bizExpAnalytics.total)} sub="Total including GST" color="#fb923c"/>
            <KPICard label="Expense Entries" val={bizExp.length} sub="logged transactions" color="#94a3b8"/>
          </div>

          {/* Category breakdown */}
          <div style={{...card,padding:18,marginBottom:20}}>
            <div className="sec">By Category</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10}}>
              {EXP_CATS.filter(cat=>bizExpAnalytics.byCat[cat]>0).map(cat=>(
                <div key={cat} style={{background:'#0a0e1a',borderRadius:10,padding:'12px 14px',borderLeft:`3px solid ${catColor(cat)}`}}>
                  <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:4}}>{cat.toUpperCase()}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:16,color:catColor(cat)}}>{fmtL(bizExpAnalytics.byCat[cat])}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Add expense form */}
          <div style={{...card,padding:20,marginBottom:20}}>
            <div style={{fontSize:12,color:'#f87171',fontFamily:"'DM Mono',monospace",marginBottom:14}}>+ ADD BUSINESS EXPENSE</div>
            <div style={{...g4,marginBottom:12}}>
              <div><label style={lbl}>Date *</label><input style={inp} type="date" value={bizExpForm.expense_date} onChange={e=>setBizExpForm({...bizExpForm,expense_date:e.target.value})}/></div>
              <div><label style={lbl}>Category *</label>
                <select style={inp} value={bizExpForm.category} onChange={e=>{
                  const cat=e.target.value;
                  setBizExpForm({...bizExpForm,category:cat,gst_rate:catHasGST(cat)?'18':'0',is_gst_claimable:catHasGST(cat)});
                }}>
                  {EXP_CATS.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Description *</label><input style={inp} type="text" placeholder="e.g. Office rent — March" value={bizExpForm.description} onChange={e=>setBizExpForm({...bizExpForm,description:e.target.value})}/></div>
              <div><label style={lbl}>Vendor / Payee</label><input style={inp} type="text" value={bizExpForm.vendor_name} onChange={e=>setBizExpForm({...bizExpForm,vendor_name:e.target.value})}/></div>
              <div><label style={lbl}>Amount excl. GST (₹) *</label><input style={inp} type="number" value={bizExpForm.amount} onChange={e=>setBizExpForm({...bizExpForm,amount:e.target.value})}/></div>
              <div><label style={lbl}>GST Rate</label>
                <select style={inp} value={bizExpForm.gst_rate} onChange={e=>setBizExpForm({...bizExpForm,gst_rate:e.target.value})}>
                  {GST_RATES.map(r=><option key={r} value={r}>{r}% {r===0?'(No GST)':''}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Payment Mode</label>
                <select style={inp} value={bizExpForm.payment_mode} onChange={e=>setBizExpForm({...bizExpForm,payment_mode:e.target.value})}>
                  {PAY_MODES.map(m=><option key={m}>{m}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Invoice Ref.</label><input style={inp} type="text" value={bizExpForm.invoice_ref} onChange={e=>setBizExpForm({...bizExpForm,invoice_ref:e.target.value})}/></div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:12}}>
              <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:'#94a3b8'}}>
                <input type="checkbox" checked={bizExpForm.is_gst_claimable} onChange={e=>setBizExpForm({...bizExpForm,is_gst_claimable:e.target.checked})} style={{accentColor:'#34d399'}}/>
                GST Claimable as Input Credit
              </label>
              {bizExpForm.amount&&Number(bizExpForm.amount)>0&&(
                <div style={{background:'#0a0e1a',borderRadius:8,padding:'8px 14px',fontSize:12,color:'#94a3b8',fontFamily:"'DM Mono',monospace",display:'flex',gap:16}}>
                  <span>Base: <strong style={{color:'#f1f5f9'}}>{fmtL(bizExpForm.amount)}</strong></span>
                  <span>GST: <strong style={{color:'#f87171'}}>{fmtL(bizExpForm.amount*(bizExpForm.gst_rate/100))}</strong></span>
                  <span>Total: <strong style={{color:'#f59e0b'}}>{fmtL(Number(bizExpForm.amount)*(1+Number(bizExpForm.gst_rate)/100))}</strong></span>
                </div>
              )}
              <button onClick={addBizExpense} disabled={saving} style={{...btn(saving,'#dc2626','#fff'),marginLeft:'auto'}}>{saving?'Saving…':'ADD EXPENSE →'}</button>
            </div>
          </div>

          {/* Filter + table */}
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12,flexWrap:'wrap'}}>
            <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace"}}>FILTER:</div>
            {['All',...EXP_CATS].map(cat=><button key={cat} onClick={()=>setExpCatFilter(cat)} style={{background:expCatFilter===cat?catColor(cat)+'22':'transparent',border:`1px solid ${expCatFilter===cat?catColor(cat):'#334155'}`,color:expCatFilter===cat?catColor(cat):'#64748b',borderRadius:20,padding:'3px 10px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:10}}>{cat}</button>)}
          </div>
          <div style={{...card,overflow:'auto'}}>
            <table>
              <thead><tr>{['Date','Category','Description','Vendor','Base Amount','GST Rate','GST','Total','GST Claimable','Payment','Invoice Ref',''].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{bizExpAnalytics.filtered.length===0
                ?<tr><td colSpan={12} style={{textAlign:'center',color:'#475569',padding:24}}>No expenses recorded yet.</td></tr>
                :bizExpAnalytics.filtered.map(e=>(
                <tr key={e.id}>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b'}}>{e.expense_date}</td>
                  <td><span style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:catColor(e.category),background:catColor(e.category)+'20',borderRadius:4,padding:'2px 6px'}}>{e.category}</span></td>
                  <td style={{fontWeight:500}}>{e.description}</td>
                  <td style={{color:'#94a3b8',fontSize:11}}>{e.vendor_name||'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(e.amount)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#94a3b8'}}>{e.gst_rate}%</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:e.gst_amount>0?'#f87171':'#475569'}}>{e.gst_amount>0?fmtL(e.gst_amount):'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171',fontWeight:600}}>{fmtL(e.total_amount)}</td>
                  <td style={{textAlign:'center'}}>{e.is_gst_claimable?<span style={{color:'#34d399',fontSize:12}}>✓</span>:<span style={{color:'#475569',fontSize:12}}>—</span>}</td>
                  <td style={{color:'#94a3b8',fontSize:11}}>{e.payment_mode}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:11}}>{e.invoice_ref||'—'}</td>
                  <td><button onClick={()=>askDelete('bizexp',e.id,`${e.category} — ${e.description}`,()=>deleteBizExp(e.id))} style={{background:'#1e293b',border:'1px solid #334155',color:'#f87171',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace"}}>🗑</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>)}

        {/* ════ CASH FLOW ════ */}
        {view==='cashflow'&&(<div>
          <div className="sec">Cash Flow Dashboard</div>
          <FYSelector/>
          {cashAnalytics?(<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:20}}>
              <KPICard label="Total Cash In (FY)" val={fmtL(cashAnalytics.totalIn)} color="#34d399"/>
              <KPICard label="Total Cash Out (FY)" val={fmtL(cashAnalytics.totalOut)} color="#f87171"/>
              <KPICard label="Net Cash Flow" val={fmtL(cashAnalytics.netCF)} color={cashAnalytics.netCF>=0?'#f59e0b':'#f87171'}/>
              <KPICard label="Expected Inflows" val={fmtL(cashAnalytics.expectedInflows)} sub="pending on open POs" color="#38bdf8"/>
            </div>
            <div style={{...card,padding:18,marginBottom:18}}>
              <div className="sec">Pipeline Forecast (Probability-Weighted)</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14}}>
                {[['Next 30 Days',cashAnalytics.forecast30,'#34d399'],['Next 60 Days',cashAnalytics.forecast60,'#f59e0b'],['Next 90 Days',cashAnalytics.forecast90,'#38bdf8']].map(([l,v,c])=>(
                  <div key={l} style={{background:'#0a0e1a',borderRadius:10,padding:14,textAlign:'center'}}>
                    <div style={{fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:6}}>{l}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:20,color:c}}>{fmtL(v)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{...card,overflow:'auto',marginBottom:18}}>
              <table>
                <thead><tr>{['Month','Cash In','Cash Out','Net','Advances','Mfr Payments','Mfr Expenses','Biz Expenses','Other Out'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>{cashAnalytics.monthly.map(m=>(
                  <tr key={m.label}>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b'}}>{m.label}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{m.cashIn>0?fmtL(m.cashIn):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171'}}>{m.cashOut>0?fmtL(m.cashOut):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:m.net>=0?'#34d399':'#f87171',fontWeight:600}}>{m.cashIn>0||m.cashOut>0?fmtL(m.net):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#94a3b8'}}>{m.advancesIn>0?fmtL(m.advancesIn):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#94a3b8'}}>{m.mfrPay>0?fmtL(m.mfrPay):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#94a3b8'}}>{m.mfrExp2>0?fmtL(m.mfrExp2):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#fb923c'}}>{m.bizExpOut>0?fmtL(m.bizExpOut):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#94a3b8'}}>{m.txnOut>0?fmtL(m.txnOut):'—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {/* Log cash transaction */}
            <div style={{...card,padding:18}}>
              <div style={{fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:12}}>+ LOG ADDITIONAL CASH TRANSACTION</div>
              <div style={{...g4,marginBottom:10}}>
                <div><label style={lbl}>Date *</label><input style={inp} type="date" value={cashForm.txn_date} onChange={e=>setCashForm({...cashForm,txn_date:e.target.value})}/></div>
                <div><label style={lbl}>Type *</label><select style={inp} value={cashForm.txn_type} onChange={e=>setCashForm({...cashForm,txn_type:e.target.value,category:e.target.value==='Cash In'?'Balance Receipt':'Manufacturer Payment'})}><option>Cash In</option><option>Cash Out</option></select></div>
                <div><label style={lbl}>Category</label><select style={inp} value={cashForm.category} onChange={e=>setCashForm({...cashForm,category:e.target.value})}>{(cashForm.txn_type==='Cash In'?['Balance Receipt','Advance Receipt','Other Income']:['Manufacturer Payment','Logistics','Other']).map(c=><option key={c}>{c}</option>)}</select></div>
                <div><label style={lbl}>Amount (₹) *</label><input style={inp} type="number" value={cashForm.amount} onChange={e=>setCashForm({...cashForm,amount:e.target.value})}/></div>
                <div><label style={lbl}>Linked PO</label><input style={inp} type="text" placeholder="PO-001" value={cashForm.reference_po} onChange={e=>setCashForm({...cashForm,reference_po:e.target.value})}/></div>
                <div><label style={lbl}>Description</label><input style={inp} type="text" value={cashForm.description} onChange={e=>setCashForm({...cashForm,description:e.target.value})}/></div>
                <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={addCashTxn} disabled={saving} style={{...btn(saving),width:'100%',padding:'11px 0'}}>{saving?'Saving…':'ADD →'}</button></div>
              </div>
            </div>
            {cashTxns.length>0&&(
              <div style={{...card,overflow:'auto',marginTop:18}}>
                <div style={{padding:'12px 16px 0',fontSize:10,color:'#64748b',fontFamily:"'DM Mono',monospace"}}>ADDITIONAL CASH TRANSACTIONS LOG</div>
                <table>
                  <thead><tr>{['Date','Type','Category','Amount','Linked PO','Description',''].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{cashTxns.map(t=>(
                    <tr key={t.id}>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b'}}>{t.txn_date}</td>
                      <td><span style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:t.txn_type==='Cash In'?'#34d399':'#f87171',background:t.txn_type==='Cash In'?'#052e16':'#450a0a',borderRadius:4,padding:'2px 6px'}}>{t.txn_type}</span></td>
                      <td style={{color:'#94a3b8',fontSize:11}}>{t.category}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:t.txn_type==='Cash In'?'#34d399':'#f87171',fontWeight:600}}>{fmtL(t.amount)}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:11}}>{t.reference_po||'—'}</td>
                      <td style={{color:'#94a3b8',fontSize:11}}>{t.description}</td>
                      <td><button onClick={()=>askDelete('cash',t.id,`${t.txn_type} — ${fmtL(t.amount)} on ${t.txn_date}`,()=>deleteCashTxn(t.id))} style={{background:'#1e293b',border:'1px solid #334155',color:'#f87171',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace"}}>🗑</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </>):<div style={{color:'#475569',fontSize:13}}>Configure a financial year in Settings first.</div>}
        </div>)}

        {/* ════ TARGET vs ACTUAL ════ */}
        {view==='target'&&(<div>
          <div className="sec">Target vs Actual</div>
          <FYSelector/>
          {targetAnalytics?(<>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:18,marginBottom:18}}>
              <div style={{...card,padding:22}}>
                <div className="sec">Achievement — {targetAnalytics.fy.fy_label}</div>
                <div style={{display:'flex',justifyContent:'space-around',padding:'8px 0'}}>
                  <Ring value={targetAnalytics.actualUnits} max={targetAnalytics.fy.target_units||1} color="#f59e0b" label="Units"/>
                  <Ring value={targetAnalytics.actualNet} max={targetAnalytics.fy.target_value||1} color="#38bdf8" label="Revenue"/>
                  <Ring value={Math.max(0,targetAnalytics.actualProfit)} max={targetAnalytics.fy.target_profit||1} color="#34d399" label="Profit"/>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginTop:14}}>
                  {[['Units',fmt(targetAnalytics.fy.target_units),fmt(targetAnalytics.actualUnits),'#f59e0b'],['Revenue',fmtL(targetAnalytics.fy.target_value),fmtL(targetAnalytics.actualNet),'#38bdf8'],['Profit',fmtL(targetAnalytics.fy.target_profit),fmtL(targetAnalytics.actualProfit),'#34d399']].map(([l,t,a,c])=>(
                    <div key={l} style={{background:'#0a0e1a',borderRadius:8,padding:10}}>
                      <div style={{fontSize:9,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:3}}>{l}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:14,color:c}}>{t}</div>
                      <div style={{fontSize:10,color:'#475569',marginTop:2}}>Actual: {a}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{...card,padding:22}}>
                <div className="sec">Run Rate & Manufacturer Slabs</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
                  <div style={{background:'#0a0e1a',borderRadius:8,padding:10}}><div style={{fontSize:9,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:3}}>PROJECTED UNITS</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:16,color:'#f59e0b'}}>{fmt(Math.round(targetAnalytics.runRateUnits))}</div></div>
                  <div style={{background:'#0a0e1a',borderRadius:8,padding:10}}><div style={{fontSize:9,color:'#64748b',fontFamily:"'DM Mono',monospace",marginBottom:3}}>PROJECTED REVENUE</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:16,color:'#38bdf8'}}>{fmtL(targetAnalytics.runRateValue)}</div></div>
                </div>
                {[1,2].map(i=>{
                  const u=targetAnalytics.fy[`mfr_slab_${i}_units`],b=targetAnalytics.fy[`mfr_slab_${i}_bonus`],hit=i===1?targetAnalytics.slab1Hit:targetAnalytics.slab2Hit,rem=i===1?targetAnalytics.unitsToSlab1:targetAnalytics.unitsToSlab2;
                  if (!u) return null;
                  return <div key={i} style={{background:hit?'#052e16':'#1a1a2e',border:`1px solid ${hit?'#14532d':'#334155'}`,borderRadius:8,padding:10,marginBottom:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                      <div><div style={{fontSize:11,color:hit?'#34d399':'#94a3b8',fontFamily:"'DM Mono',monospace"}}>Slab {i} — {fmt(u)} units → Bonus {fmtL(b)}</div><div style={{fontSize:10,color:'#475569',marginTop:2}}>{hit?'✓ ACHIEVED':'Need '+fmt(rem)+' more'}</div></div>
                      <div style={{fontSize:18}}>{hit?'🏆':'🎯'}</div>
                    </div>
                    <div style={{height:4,background:'#1e293b',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(100,(targetAnalytics.actualUnits/u)*100)}%`,background:hit?'#34d399':'#f59e0b',borderRadius:2}}/></div>
                  </div>;
                })}
              </div>
            </div>
            <div style={{...card,padding:18,marginBottom:14}}><div className="sec">Monthly Units</div><BarChart data={targetAnalytics.monthly} valueKey="units" labelKey="label" color="#f59e0b" height={90}/></div>
            <div style={{...card,padding:18}}><div className="sec">Monthly Revenue</div><BarChart data={targetAnalytics.monthly} valueKey="value" labelKey="label" color="#38bdf8" height={90}/></div>
          </>):<div style={{color:'#475569',fontSize:13}}>Set targets in Settings → Annual Targets.</div>}
        </div>)}

        {/* ════ AGING ════ */}
        {view==='aging'&&(<div>
          <div className="sec">Receivables Aging</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:14,marginBottom:20}}>
            <KPICard label="Total Outstanding" val={fmtL(agingAnalytics.total)} color="#f87171"/>
            {Object.entries(agingAnalytics.buckets).map(([b,v])=>{
              const c=b==='0-30'?'#34d399':b==='31-60'?'#f59e0b':b==='61-90'?'#fb923c':'#f87171';
              return <KPICard key={b} label={`${b} Days`} val={fmtL(v)} sub={agingAnalytics.total>0?pct((v/agingAnalytics.total)*100)+' of total':''} color={c}/>;
            })}
          </div>
          <div style={{...card,padding:16,marginBottom:16}}>
            <div style={{height:12,borderRadius:6,overflow:'hidden',display:'flex',marginBottom:6}}>
              {Object.entries(agingAnalytics.buckets).map(([b,v])=>{ const c=b==='0-30'?'#34d399':b==='31-60'?'#f59e0b':b==='61-90'?'#fb923c':'#f87171'; const w=agingAnalytics.total>0?(v/agingAnalytics.total)*100:0; return w>0?<div key={b} style={{width:`${w}%`,background:c}}/>:null; })}
            </div>
            <div style={{display:'flex',gap:14,fontSize:10,fontFamily:"'DM Mono',monospace"}}>
              {[['0-30','#34d399'],['31-60','#f59e0b'],['61-90','#fb923c'],['90+','#f87171']].map(([b,c])=><div key={b} style={{display:'flex',alignItems:'center',gap:4}}><div style={{width:7,height:7,borderRadius:'50%',background:c}}/><span style={{color:'#64748b'}}>{b} days</span></div>)}
            </div>
          </div>
          <div style={{...card,overflow:'auto'}}>
            <table>
              <thead><tr>{['PO No','Customer','PO Date','Days','Order Value','Advance','Balance Due','Stage','Bucket'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{agingAnalytics.aged.length===0?<tr><td colSpan={9} style={{textAlign:'center',color:'#475569',padding:24}}>No outstanding balances</td></tr>
                :agingAnalytics.aged.sort((a,b)=>b.days-a.days).map(p=>{ const bc=p.bucket==='0-30'?'#34d399':p.bucket==='31-60'?'#f59e0b':p.bucket==='61-90'?'#fb923c':'#f87171'; return (
                  <tr key={p.id}>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b'}}>{p.id}</td>
                    <td style={{fontWeight:500}}>{p.custName}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b'}}>{p.po_date}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:bc,fontWeight:600}}>{p.days}d</td>
                    <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(p.qty*p.unit_price)}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{fmtL(p.advance)}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:bc,fontWeight:600}}>{fmtL(p.bal)}</td>
                    <td><StatusBadge s={p.status}/></td>
                    <td><span className="chip" style={{background:bc+'20',color:bc,borderColor:bc}}>{p.bucket}d</span></td>
                  </tr>
                );})
              }</tbody>
            </table>
          </div>
        </div>)}

        {/* ════ GST ════ */}
        {view==='gst'&&(<div>
          <div className="sec">GST Summary</div>
          <FYSelector/>
          {gstAnalytics?(<>
            <div style={{background:'#1a1a2e',border:'1px solid #334155',borderRadius:10,padding:'10px 14px',marginBottom:16,fontSize:11,color:'#64748b',fontFamily:"'DM Mono',monospace",display:'flex',alignItems:'center',gap:8}}>
              <span>📌</span>
              <span>Sales GST Rate: <strong style={{color:'#f59e0b'}}>{gstAnalytics.ratePct}</strong> — configurable in Settings. Input GST on expenses uses each expense's own rate.</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:20}}>
              <KPICard label="Output GST (Collected)" val={fmtL(gstAnalytics.tOut)} sub="GST charged on sales" color="#f87171"/>
              <KPICard label="Input GST Credit" val={fmtL(gstAnalytics.tIn)} sub="Purchases + claimable expenses" color="#34d399"/>
              <KPICard label="Net GST Payable" val={fmtL(gstAnalytics.tNet)} sub={gstAnalytics.tNet>=0?'Payable to Govt':'Credit with Govt'} color={gstAnalytics.tNet>=0?'#f59e0b':'#34d399'}/>
            </div>
            <div style={{...card,overflow:'auto'}}>
              <table>
                <thead><tr>{['Month','Output GST','Input: Purchase','Input: Mfr Exp','Input: Biz Exp','Total Input','Net Payable'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>{gstAnalytics.monthly.map(m=>(
                  <tr key={m.label}>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b'}}>{m.label}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171'}}>{m.outputGST>0?fmtL(m.outputGST):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{m.inputGSTPurch>0?fmtL(m.inputGSTPurch):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{m.inputGSTMfrExp>0?fmtL(m.inputGSTMfrExp):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{m.inputGSTBizExp>0?fmtL(m.inputGSTBizExp):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{m.totalInput>0?fmtL(m.totalInput):'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:m.netGST>=0?'#f59e0b':'#34d399',fontWeight:600}}>{m.outputGST>0||m.totalInput>0?fmtL(m.netGST):'—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>):<div style={{color:'#475569',fontSize:13}}>Configure a financial year in Settings first.</div>}
        </div>)}

        {/* ════ PIPELINE ════ */}
        {view==='pipeline'&&(<div>
          <div className="sec">Forward Order Pipeline</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:20}}>
            <KPICard label="Active (Units)" val={fmt(pipeAnalytics.totalExpUnits)} color="#f59e0b"/>
            <KPICard label="Expected Value" val={fmtL(pipeAnalytics.totalExpValue)} color="#38bdf8"/>
            <KPICard label="Probability-Weighted" val={fmtL(pipeAnalytics.weightedValue)} color="#34d399"/>
            <KPICard label="Active Opportunities" val={pipeAnalytics.active.length} color="#a78bfa"/>
          </div>
          <div style={{...card,padding:18,marginBottom:18}}>
            <div style={{fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:12}}>+ ADD OPPORTUNITY</div>
            <div style={{...g4,marginBottom:10}}>
              <div><label style={lbl}>Customer *</label><select style={inp} value={pipeForm.customer_id} onChange={e=>setPipeForm({...pipeForm,customer_id:e.target.value})}><option value="">Select…</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label style={lbl}>Qty *</label><input style={inp} type="number" value={pipeForm.expected_qty} onChange={e=>setPipeForm({...pipeForm,expected_qty:e.target.value})}/></div>
              <div><label style={lbl}>Expected Value (₹)</label><input style={inp} type="number" value={pipeForm.expected_value} onChange={e=>setPipeForm({...pipeForm,expected_value:e.target.value})}/></div>
              <div><label style={lbl}>Expected Date *</label><input style={inp} type="date" value={pipeForm.expected_date} onChange={e=>setPipeForm({...pipeForm,expected_date:e.target.value})}/></div>
              <div><label style={lbl}>Delivery</label><select style={inp} value={pipeForm.delivery_type} onChange={e=>setPipeForm({...pipeForm,delivery_type:e.target.value})}><option value="DDP">DDP</option><option value="EXW">EXW</option></select></div>
              <div><label style={lbl}>Probability</label><select style={inp} value={pipeForm.probability} onChange={e=>setPipeForm({...pipeForm,probability:e.target.value})}>{[25,50,75,90,100].map(p=><option key={p} value={p}>{p}%</option>)}</select></div>
              <div><label style={lbl}>Notes</label><input style={inp} type="text" value={pipeForm.notes} onChange={e=>setPipeForm({...pipeForm,notes:e.target.value})}/></div>
              <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={addPipeline} disabled={saving} style={{...btn(saving),width:'100%',padding:'11px 0'}}>{saving?'Saving…':'ADD →'}</button></div>
            </div>
          </div>
          <div style={{...card,overflow:'auto'}}>
            <table>
              <thead><tr>{['Customer','Qty','Expected Value','Probability','Weighted','Expected Date','Type','Status','Notes','Update',''].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{pipeline.map(p=>{ const cust=customers.find(c=>c.id===p.customer_id),val=p.expected_value||p.expected_qty*(p.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw); const sc={Active:'#38bdf8',Won:'#34d399',Lost:'#f87171',Deferred:'#f59e0b'};
                return (<tr key={p.id}>
                  <td style={{fontWeight:500}}>{cust?.name||'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{p.expected_qty}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(val)}</td>
                  <td><div style={{display:'flex',alignItems:'center',gap:6}}><div style={{flex:1,height:4,background:'#1e293b',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',width:`${p.probability}%`,background:'#38bdf8',borderRadius:2}}/></div><span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:'#38bdf8'}}>{p.probability}%</span></div></td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{fmtL(val*p.probability/100)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b'}}>{p.expected_date}</td>
                  <td><span style={{fontSize:10,background:p.delivery_type==='DDP'?'#1e3a5f':'#1e3a2f',color:p.delivery_type==='DDP'?'#38bdf8':'#34d399',borderRadius:4,padding:'2px 5px',fontFamily:"'DM Mono',monospace"}}>{p.delivery_type}</span></td>
                  <td><span style={{fontSize:10,color:sc[p.status],fontFamily:"'DM Mono',monospace"}}>{p.status}</span></td>
                  <td style={{color:'#94a3b8',fontSize:11,maxWidth:140}}>{p.notes}</td>
                  <td><select style={{...inp,width:'auto',fontSize:10,padding:'3px 6px'}} value={p.status} onChange={e=>updatePipelineStatus(p.id,e.target.value)}>{['Active','Won','Lost','Deferred'].map(s=><option key={s}>{s}</option>)}</select></td>
                  <td><button onClick={()=>askDelete('pipe',p.id,`Pipeline — ${cust?.name||''} ${p.expected_qty} units`,()=>deletePipeline(p.id))} style={{background:'#1e293b',border:'1px solid #334155',color:'#f87171',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace"}}>🗑</button></td>
                </tr>);
              })}</tbody>
            </table>
          </div>
        </div>)}

        {/* ════ PENDING ORDERS ════ */}
        {view==='unfulfilled'&&(<div>
          <div className="sec">Pending Orders</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
            <KPICard label="Open Orders" val={fmt(analytics.unfulfilled.length)} color="#f59e0b"/>
            <KPICard label="Total Order Value" val={fmtL(analytics.unfulfilled.reduce((s,p)=>s+p.qty*p.unit_price,0))} color="#38bdf8"/>
            <KPICard label="Advances Received" val={fmtL(analytics.unfulfilled.reduce((s,p)=>s+Number(p.advance),0))} color="#34d399"/>
            <KPICard label="Balance Pending" val={fmtL(analytics.unfulfilled.reduce((s,p)=>s+Math.max(0,p.qty*p.unit_price-p.advance),0))} color="#f87171"/>
          </div>
          <div style={{...card,overflow:'auto'}}>
            <table>
              <thead><tr>{['PO No','Customer','Qty','Order Value','Advance','Balance','Stage','Progress','Invoice No','Invoice Date','Dispatch Date','Update'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{analytics.unfulfilled.length===0?<tr><td colSpan={12} style={{textAlign:'center',color:'#475569',padding:28}}>✓ All orders delivered</td></tr>
                :analytics.unfulfilled.map(p=>{ const cust=customers.find(c=>c.id===p.customer_id),val=p.qty*p.unit_price,bal=Math.max(0,val-p.advance); return (
                  <tr key={p.id}>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b'}}>{p.id}</td>
                    <td style={{fontWeight:500}}>{cust?.name||'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace"}}>{p.qty}</td>
                    <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(val)}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399'}}>{fmtL(p.advance)}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:bal>0?'#f87171':'#34d399',fontWeight:600}}>{fmtL(bal)}</td>
                    <td><StatusBadge s={p.status}/></td>
                    <td><StagePipeline current={p.status}/></td>
                    <td><input style={{...inp,width:110,fontSize:10,padding:'3px 8px'}} placeholder="INV-001" defaultValue={p.invoice_no||''} onBlur={e=>{ if(e.target.value!==p.invoice_no) updatePOField(p.id,'invoice_no',e.target.value);}}/></td>
                    <td><input style={{...inp,width:125,fontSize:10,padding:'3px 8px'}} type="date" defaultValue={p.invoice_date||''} onBlur={e=>{ if(e.target.value!==p.invoice_date) updatePOField(p.id,'invoice_date',e.target.value);}}/></td>
                    <td><input style={{...inp,width:125,fontSize:10,padding:'3px 8px'}} type="date" defaultValue={p.dispatch_date||''} onBlur={e=>{ if(e.target.value!==p.dispatch_date) updatePOField(p.id,'dispatch_date',e.target.value);}}/></td>
                    <td><select style={{...inp,width:'auto',fontSize:10,padding:'3px 6px'}} value={p.status} onChange={e=>updatePOStatus(p.id,e.target.value)}>{PO_STAGES.map(s=><option key={s}>{s}</option>)}</select></td>
                  </tr>
                );})
              }</tbody>
            </table>
          </div>
        </div>)}

        {/* ════ ORDERS ════ */}
        {view==='pos'&&(<div>
          <div className="sec">All Purchase Orders</div>
          <div style={{...card,padding:18,marginBottom:16}}>
            <div style={{fontSize:11,color:'#c8a96e',fontFamily:"'DM Mono',monospace",marginBottom:12}}>+ NEW PURCHASE ORDER</div>
            <div style={{...g4,marginBottom:12}}>
              <div>
                <label style={lbl}>PO Number * <span style={{color:'#3a3a5a',fontSize:9,textTransform:'none',letterSpacing:0}}>(auto or manual)</span></label>
                <div style={{display:'flex',gap:6}}>
                  <input style={{...inp,flex:1}} type="text" placeholder={`${COMPANY.poPrefix}0001/25-26`} value={poForm.po_id} onChange={e=>setPoForm({...poForm,po_id:e.target.value})}/>
                  <button type="button" onClick={()=>setPoForm({...poForm,po_id:nextPONumber()})} style={{...btn(false,'#1a1a2e','#c8a96e'),border:'1px solid #c8a96e',padding:'8px 10px',fontSize:10,flexShrink:0}}>AUTO</button>
                </div>
              </div>
              <div><label style={lbl}>Customer *</label><select style={inp} value={poForm.customer_id} onChange={e=>setPoForm({...poForm,customer_id:e.target.value})}><option value="">Select…</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label style={lbl}>Delivery *</label><select style={inp} value={poForm.delivery_type} onChange={e=>{ const def=e.target.value==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw; setPoForm({...poForm,delivery_type:e.target.value,purchase_price:def}); }}><option value="DDP">DDP</option><option value="EXW">EXW</option></select></div>
              <div><label style={lbl}>Qty *</label><input style={inp} type="number" value={poForm.qty} onChange={e=>setPoForm({...poForm,qty:e.target.value})}/></div>
              <div><label style={lbl}>Unit Price (₹) *</label><input style={inp} type="number" value={poForm.unit_price} onChange={e=>{ const up=Number(e.target.value); const da=poForm.discount_pct>0?parseFloat((up*poForm.qty*poForm.discount_pct/100).toFixed(2)):poForm.discount_amount; setPoForm({...poForm,unit_price:e.target.value,discount_amount:da}); }}/></div>
              <div><label style={lbl}>Discount %</label><input style={inp} type="number" min="0" max="100" placeholder="0" value={poForm.discount_pct} onChange={e=>{ const dp=Number(e.target.value); const da=parseFloat((Number(poForm.unit_price)*Number(poForm.qty)*dp/100).toFixed(2)); setPoForm({...poForm,discount_pct:e.target.value,discount_amount:da}); }}/></div>
              <div><label style={lbl}>Discount Amt (₹)</label><input style={inp} type="number" placeholder="0" value={poForm.discount_amount} onChange={e=>{ const da=Number(e.target.value); const base=Number(poForm.unit_price)*Number(poForm.qty); const dp=base>0?parseFloat((da/base*100).toFixed(2)):0; setPoForm({...poForm,discount_amount:e.target.value,discount_pct:dp}); }}/></div>
            </div>
            {/* Live invoice preview */}
            {poForm.qty&&poForm.unit_price&&(()=>{
              const gross=Number(poForm.qty)*Number(poForm.unit_price);
              const disc=Number(poForm.discount_amount||0);
              const netTax=gross-disc;
              const gstAmt=netTax*(settings.gst_rate_sales||12)/100;
              const invTotal=netTax+gstAmt;
              const profitGross=netTax-Number(poForm.qty)*Number(poForm.purchase_price||0);
              return <div style={{background:'#0a0e1a',border:'1px solid #334155',borderRadius:10,padding:'10px 16px',marginBottom:12,display:'flex',gap:20,flexWrap:'wrap',fontSize:12,fontFamily:"'DM Mono',monospace"}}>
                <span style={{color:'#64748b'}}>Taxable: <strong style={{color:'#e2e8f0'}}>{fmtL(gross)}</strong></span>
                {disc>0&&<span style={{color:'#64748b'}}>Discount: <strong style={{color:'#f87171'}}>−{fmtL(disc)}</strong></span>}
                {disc>0&&<span style={{color:'#64748b'}}>Net Taxable: <strong style={{color:'#f59e0b'}}>{fmtL(netTax)}</strong></span>}
                <span style={{color:'#64748b'}}>GST ({settings.gst_rate_sales||12}%): <strong style={{color:'#a78bfa'}}>{fmtL(gstAmt)}</strong></span>
                <span style={{color:'#64748b'}}>Invoice Total: <strong style={{color:'#38bdf8'}}>{fmtL(invTotal)}</strong></span>
                {poForm.purchase_price&&<span style={{color:'#64748b'}}>Gross Profit: <strong style={{color:profitGross>=0?'#34d399':'#f87171'}}>{fmtL(profitGross)}</strong></span>}
              </div>;
            })()}
            <div style={{background:'#0a0e1a',border:'1px solid #334155',borderRadius:10,padding:12,marginBottom:12}}>
              <div style={{fontSize:10,color:'#6366f1',fontFamily:"'DM Mono',monospace",marginBottom:10}}>VENDOR / PURCHASE</div>
              <div style={{...g4}}>
                <div><label style={lbl}>Vendor</label><select style={inp} value={poForm.vendor_id} onChange={e=>setPoForm({...poForm,vendor_id:e.target.value})}><option value="">Select vendor…</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name} ({v.vendor_type})</option>)}</select></div>
                <div><label style={lbl}>Purchase Price (₹) *</label><input style={{...inp,borderColor:Number(poForm.purchase_price)!==(poForm.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw)&&poForm.purchase_price?'#6366f1':'#334155'}} type="number" value={poForm.purchase_price} onChange={e=>setPoForm({...poForm,purchase_price:e.target.value})}/></div>
                <div><label style={lbl}>Vendor Invoice</label><input style={inp} type="text" value={poForm.vendor_invoice_no} onChange={e=>setPoForm({...poForm,vendor_invoice_no:e.target.value})}/></div>
                <div><label style={lbl}>Purchase Date</label><input style={inp} type="date" value={poForm.purchase_date} onChange={e=>setPoForm({...poForm,purchase_date:e.target.value})}/></div>
              </div>
            </div>
            <div style={{...g4}}>
              <div><label style={lbl}>Advance (₹) *</label><input style={inp} type="number" value={poForm.advance} onChange={e=>setPoForm({...poForm,advance:e.target.value})}/></div>
              <div><label style={lbl}>PO Date *</label><input style={inp} type="date" value={poForm.po_date} onChange={e=>setPoForm({...poForm,po_date:e.target.value})}/></div>
              <div><label style={lbl}>Status</label><select style={inp} value={poForm.status} onChange={e=>setPoForm({...poForm,status:e.target.value})}>{PO_STAGES.map(s=><option key={s}>{s}</option>)}</select></div>
              <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={addPO} disabled={saving} style={{...btn(saving),width:'100%',padding:'11px 0'}}>{saving?'Saving…':'ADD PO →'}</button></div>
            </div>
          </div>
          {/* Search bar */}
          <div style={{marginBottom:10}}>
            <input className="search-bar" type="text" placeholder="🔍  Search PO number, customer name, vendor…" value={searchPO} onChange={e=>setSearchPO(e.target.value)}/>
          </div>
          <div style={{...card,overflow:'auto'}}>
            <table>
              <thead><tr>{['PO No','Customer','Type','Vendor','Ordered Qty','Ordered Value','Discount','Delivered Qty','Bal Qty','Invoiced Amt','Advance','Balance Due','Date','Stage','Edit','Status'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{pos.filter(p=>{ if(!searchPO) return true; const q=searchPO.toLowerCase(); const c=customers.find(x=>x.id===p.customer_id); return p.id?.toLowerCase().includes(q)||c?.name?.toLowerCase().includes(q)||p.vendor_name?.toLowerCase().includes(q); }).map(p=>{ 
                const cust=customers.find(c=>c.id===p.customer_id);
                const fin=poFinancials(p);
                return (
                <tr key={p.id}>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#c8a96e',whiteSpace:'nowrap'}}>{p.id}</td>
                  <td style={{fontWeight:500}}>{cust?.name||'—'}</td>
                  <td><span style={{fontSize:10,background:p.delivery_type==='DDP'?'#1a2a3a':'#1a2a1a',color:p.delivery_type==='DDP'?'#7ab8d4':'#7ab87a',borderRadius:2,padding:'2px 6px',fontFamily:"'DM Mono',monospace"}}>{p.delivery_type}</span></td>
                  <td style={{color:'#5a5a7a',fontSize:11,whiteSpace:'nowrap'}}>{p.vendor_name||'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",textAlign:'center'}}>{fin.orderedQty}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#5a5a7a'}}>{fmtL(fin.orderedTotal)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#c47a7a'}}>{fin.orderedDiscount>0?`−${fmtL(fin.orderedDiscount)}`:'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#7ab87a',fontWeight:600,textAlign:'center'}}>{fin.deliveredQty}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:fin.balQty>0?'#c8a050':'#7ab87a',fontWeight:600,textAlign:'center'}}>{fin.balQty}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#7ab8d4',fontWeight:600}}>
                    {fmtL(fin.invoicedAmt)}
                    {fin.deliveredQty<fin.orderedQty&&fin.deliveredQty>0&&<div style={{fontSize:9,color:'#3a3a5a',marginTop:1}}>of {fmtL(fin.orderedTotal)} ordered</div>}
                  </td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#7ab87a'}}>
                    <input style={{...inp,width:110,fontSize:11,padding:'3px 8px',fontFamily:"'DM Mono',monospace",color:'#7ab87a'}} type="number" defaultValue={p.advance} onBlur={e=>{ if(Number(e.target.value)!==Number(p.advance)) updatePOField(p.id,'advance',e.target.value); }}/>
                  </td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:fin.balanceDue>0?'#c47a7a':'#7ab87a',fontWeight:700}}>{fmtL(fin.balanceDue)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:10}}>{p.po_date}</td>
                  <td><StatusBadge s={p.status}/></td>
                  <td>
                    <div style={{display:'flex',gap:4}}>
                      <button onClick={()=>openEditPO(p)} style={{background:'#1e293b',border:'1px solid #334155',color:'#f59e0b',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace",whiteSpace:'nowrap'}}>✏ Edit</button>
                      <button onClick={()=>askDelete('po',p.id,`PO ${p.id}`,()=>deletePO(p.id))} style={{background:'#1e293b',border:'1px solid #334155',color:'#f87171',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace"}}>🗑</button>
                    </div>
                  </td>
                  <td><select style={{...inp,width:'auto',fontSize:10,padding:'3px 6px'}} value={p.status} onChange={e=>updatePOStatus(p.id,e.target.value)}>{PO_STAGES.map(s=><option key={s}>{s}</option>)}</select></td>
                </tr>
              );})}</tbody>
            </table>
          </div>
        </div>)}

        {/* ════ PO EDIT MODAL ════ */}
        {editPO&&(
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={e=>{ if(e.target===e.currentTarget) setEditPO(null); }}>
            <div style={{background:'#0f172a',border:'1px solid #334155',borderRadius:20,padding:28,width:'100%',maxWidth:760,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 24px 64px rgba(0,0,0,0.7)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
                <div>
                  <div style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b',fontSize:13}}>EDIT PURCHASE ORDER</div>
                  <div style={{fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:11,marginTop:2}}>{editPO.id}</div>
                </div>
                <button onClick={()=>setEditPO(null)} style={{background:'transparent',border:'1px solid #334155',color:'#64748b',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:12}}>✕ Close</button>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                <div><label style={lbl}>Customer *</label>
                  <select style={inp} value={editForm.customer_id} onChange={e=>setEditForm({...editForm,customer_id:e.target.value})}>
                    {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div><label style={lbl}>Delivery Type</label>
                  <select style={inp} value={editForm.delivery_type} onChange={e=>setEditForm({...editForm,delivery_type:e.target.value})}>
                    <option value="DDP">DDP</option><option value="EXW">EXW</option>
                  </select>
                </div>
                <div><label style={lbl}>Qty *</label>
                  <input style={inp} type="number" value={editForm.qty} onChange={e=>setEditForm({...editForm,qty:e.target.value})}/>
                </div>
                <div><label style={lbl}>Unit Selling Price (₹) *</label>
                  <input style={inp} type="number" value={editForm.unit_price} onChange={e=>setEditForm({...editForm,unit_price:e.target.value})}/>
                </div>
              </div>

              <div style={{background:'#0a0e1a',border:'1px solid #334155',borderRadius:10,padding:14,marginBottom:14}}>
                <div style={{fontSize:10,color:'#6366f1',fontFamily:"'DM Mono',monospace",marginBottom:10}}>VENDOR / PURCHASE</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <div><label style={lbl}>Vendor Name</label>
                    <input style={inp} type="text" value={editForm.vendor_name} onChange={e=>setEditForm({...editForm,vendor_name:e.target.value})}/>
                  </div>
                  <div><label style={lbl}>Purchase Price (₹) *</label>
                    <input style={{...inp,borderColor:Number(editForm.purchase_price)!==(editForm.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw)?'#6366f1':'#334155'}}
                      type="number" value={editForm.purchase_price} onChange={e=>setEditForm({...editForm,purchase_price:e.target.value})}/>
                    {Number(editForm.purchase_price)!==(editForm.delivery_type==='DDP'?settings.default_purchase_price_ddp:settings.default_purchase_price_exw)&&<div style={{fontSize:10,color:'#6366f1',marginTop:3}}>⚡ Non-MSA price</div>}
                  </div>
                  <div><label style={lbl}>Vendor Invoice No.</label>
                    <input style={inp} type="text" value={editForm.vendor_invoice_no} onChange={e=>setEditForm({...editForm,vendor_invoice_no:e.target.value})}/>
                  </div>
                  <div><label style={lbl}>Purchase Date</label>
                    <input style={inp} type="date" value={editForm.purchase_date} onChange={e=>setEditForm({...editForm,purchase_date:e.target.value})}/>
                  </div>
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                <div><label style={lbl}>Advance Received (₹) *</label>
                  <input style={inp} type="number" value={editForm.advance} onChange={e=>setEditForm({...editForm,advance:e.target.value})}/>
                </div>
                <div><label style={lbl}>PO Date *</label>
                  <input style={inp} type="date" value={editForm.po_date} onChange={e=>setEditForm({...editForm,po_date:e.target.value})}/>
                </div>
                <div><label style={lbl}>Invoice Number</label>
                  <input style={inp} type="text" value={editForm.invoice_no} onChange={e=>setEditForm({...editForm,invoice_no:e.target.value})}/>
                </div>
                <div><label style={lbl}>Invoice Date</label>
                  <input style={inp} type="date" value={editForm.invoice_date} onChange={e=>setEditForm({...editForm,invoice_date:e.target.value})}/>
                </div>
                <div><label style={lbl}>Dispatch Date</label>
                  <input style={inp} type="date" value={editForm.dispatch_date} onChange={e=>setEditForm({...editForm,dispatch_date:e.target.value})}/>
                </div>
                <div><label style={lbl}>Status</label>
                  <select style={inp} value={editForm.status} onChange={e=>setEditForm({...editForm,status:e.target.value})}>
                    {PO_STAGES.map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Live profit preview */}
              {editForm.qty&&editForm.unit_price&&editForm.purchase_price&&(
                <div style={{background:'#0a0e1a',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,fontFamily:"'DM Mono',monospace",display:'flex',gap:20,flexWrap:'wrap'}}>
                  <span style={{color:'#64748b'}}>Invoice: <strong style={{color:'#f1f5f9'}}>{fmtL(editForm.qty*editForm.unit_price)}</strong></span>
                  <span style={{color:'#64748b'}}>Cost: <strong style={{color:'#f1f5f9'}}>{fmtL(editForm.qty*editForm.purchase_price)}</strong></span>
                  <span style={{color:'#64748b'}}>Gross Profit: <strong style={{color:(editForm.qty*editForm.unit_price-editForm.qty*editForm.purchase_price)>=0?'#34d399':'#f87171'}}>{fmtL(editForm.qty*editForm.unit_price-editForm.qty*editForm.purchase_price)}</strong></span>
                  <span style={{color:'#64748b'}}>Balance Due: <strong style={{color:'#f87171'}}>{fmtL(Math.max(0,editForm.qty*editForm.unit_price-editForm.advance))}</strong></span>
                </div>
              )}

              <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                <button onClick={()=>setEditPO(null)} style={{background:'transparent',border:'1px solid #334155',color:'#64748b',borderRadius:8,padding:'10px 20px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:12}}>Cancel</button>
                <button onClick={saveEditPO} disabled={saving} style={{...btn(saving),padding:'10px 28px'}}>{saving?'Saving…':'SAVE CHANGES →'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ════ CN/FOC ════ */}
        {view==='cns'&&(<div>
          <div className="sec">Credit Notes & FOC</div>
          <div style={{...card,padding:18,marginBottom:16}}>
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
              <thead><tr>{['ID','PO','Customer','Type','CN Amount','FOC Units','FOC Cost','Date','Remarks',''].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{cns.map(c=>{ const cust=customers.find(x=>x.id===c.customer_id),po=pos.find(p=>p.id===c.po_id),fc=c.type==='FOC'?c.foc_units*Number(po?.purchase_price||0):0; return (
                <tr key={c.id}>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b'}}>{c.id}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{c.po_id}</td>
                  <td>{cust?.name||'—'}</td>
                  <td><span style={{fontSize:10,background:c.type==='CNNote'?'#2d1f3d':'#1f2d1f',color:c.type==='CNNote'?'#c084fc':'#4ade80',borderRadius:4,padding:'2px 5px',fontFamily:"'DM Mono',monospace"}}>{c.type==='CNNote'?'CN':'FOC'}</span></td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171'}}>{c.type==='CNNote'?fmtL(c.amount):'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#e879f9'}}>{c.type==='FOC'?c.foc_units:'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171'}}>{c.type==='FOC'?fmtL(fc):'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b'}}>{c.cn_date}</td>
                  <td style={{color:'#94a3b8',fontSize:11}}>{c.note}</td>
                  <td><button onClick={()=>askDelete('cn',c.id,`${c.type==='CNNote'?'Credit Note':'FOC'} ${c.id}`,()=>deleteCN(c.id))} style={{background:'#1e293b',border:'1px solid #334155',color:'#f87171',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace"}}>🗑</button></td>
                </tr>
              );})}</tbody>
            </table>
          </div>
        </div>)}

        {/* ════ CUSTOMERS ════ */}
        {view==='customers'&&(<div>
          <div className="sec">Customer Master</div>
          <div style={{...card,padding:20,marginBottom:16}}>
            <div style={{fontSize:12,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:12}}>+ ADD CUSTOMER</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:10}}>
              <div>
                <label style={lbl}>Customer Code <span style={{color:'#475569',fontSize:10,textTransform:'none',letterSpacing:0}}>(unique ref)</span></label>
                <input style={inp} type="text" placeholder="e.g. CUST-001 or ABC" value={custForm.customer_code} onChange={e=>setCustForm({...custForm,customer_code:e.target.value})}/>
              </div>
              <div><label style={lbl}>Customer Name *</label><input style={inp} type="text" value={custForm.name} onChange={e=>setCustForm({...custForm,name:e.target.value})}/></div>
              <div><label style={lbl}>GSTIN</label><input style={inp} type="text" value={custForm.gstin} onChange={e=>setCustForm({...custForm,gstin:e.target.value})}/></div>
              <div><label style={lbl}>Contact Person</label><input style={inp} type="text" value={custForm.contact_name} onChange={e=>setCustForm({...custForm,contact_name:e.target.value})}/></div>
              <div><label style={lbl}>Phone</label><input style={inp} type="text" value={custForm.phone} onChange={e=>setCustForm({...custForm,phone:e.target.value})}/></div>
              <div><label style={lbl}>Email</label><input style={inp} type="email" value={custForm.email} onChange={e=>setCustForm({...custForm,email:e.target.value})}/></div>
              <div><label style={lbl}>Address</label><input style={inp} type="text" value={custForm.address} onChange={e=>setCustForm({...custForm,address:e.target.value})}/></div>
              <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={addCustomer} disabled={saving} style={{...btn(saving),width:'100%',padding:'11px 0'}}>{saving?'Saving…':'ADD →'}</button></div>
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <input className="search-bar" type="text" placeholder="🔍  Search customer name, code, GSTIN…" value={searchCust} onChange={e=>setSearchCust(e.target.value)}/>
          </div>
          <div style={{...card,overflow:'auto'}}>
            <table>
              <thead><tr>{['Code','Name','GSTIN','Contact','Phone','Email','POs','Net Sales','Profit','Margin','Pending','Status',''].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{customers.filter(c=>{ if(!searchCust) return true; const q=searchCust.toLowerCase(); return c.name?.toLowerCase().includes(q)||c.customer_code?.toLowerCase().includes(q)||c.gstin?.toLowerCase().includes(q); }).map((c)=>{ const a=analytics.perCustomer.find(x=>x.id===c.id); return (
                <tr key={c.id}>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b',fontWeight:600}}>{c.customer_code||<span style={{color:'#334155',fontSize:10}}>no code</span>}</td>
                  <td style={{fontWeight:500}}>{c.name}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:10}}>{c.gstin||'—'}</td>
                  <td style={{color:'#94a3b8',fontSize:11}}>{c.contact_name||'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#94a3b8',fontSize:11}}>{c.phone||'—'}</td>
                  <td style={{color:'#94a3b8',fontSize:11}}>{c.email||'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{pos.filter(p=>p.customer_id===c.id).length}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(a?.netSales||0)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:(a?.profit||0)>=0?'#34d399':'#f87171'}}>{fmtL(a?.profit||0)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{pct(a?.margin||0)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:(a?.pending||0)>0?'#f87171':'#34d399'}}>{fmtL(a?.pending||0)}</td>
                  <td>{a?.atRisk?<span className="chip" style={{background:'#450a0a',color:'#f87171',borderColor:'#7f1d1d'}}>⚠ RISK</span>:<span className="chip" style={{background:'#052e16',color:'#34d399',borderColor:'#14532d'}}>✓ OK</span>}</td>
                  <td><button onClick={()=>openEditCustomer(c)} style={{background:'#1e293b',border:'1px solid #334155',color:'#f59e0b',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace",whiteSpace:'nowrap'}}>✏ Edit</button></td>
                </tr>
              );})}</tbody>
            </table>
          </div>
        </div>)}

        {/* ── Customer Edit Modal ── */}
        {editCustomer&&(
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={e=>{ if(e.target===e.currentTarget) setEditCustomer(null); }}>
            <div style={{background:'#0f172a',border:'1px solid #334155',borderRadius:20,padding:28,width:'100%',maxWidth:640,boxShadow:'0 24px 64px rgba(0,0,0,0.7)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
                <div>
                  <div style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b',fontSize:13}}>EDIT CUSTOMER</div>
                  <div style={{fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:11,marginTop:2}}>{editCustomer.name}</div>
                </div>
                <button onClick={()=>setEditCustomer(null)} style={{background:'transparent',border:'1px solid #334155',color:'#64748b',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:12}}>✕ Close</button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                <div>
                  <label style={lbl}>Customer Code</label>
                  <input style={inp} type="text" placeholder="e.g. CUST-001" value={editCustForm.customer_code} onChange={e=>setEditCustForm({...editCustForm,customer_code:e.target.value})}/>
                  <div style={{fontSize:10,color:'#475569',marginTop:3}}>Must be unique across all customers</div>
                </div>
                <div><label style={lbl}>Customer Name *</label><input style={inp} type="text" value={editCustForm.name} onChange={e=>setEditCustForm({...editCustForm,name:e.target.value})}/></div>
                <div><label style={lbl}>GSTIN</label><input style={inp} type="text" value={editCustForm.gstin} onChange={e=>setEditCustForm({...editCustForm,gstin:e.target.value})}/></div>
                <div><label style={lbl}>Contact Person</label><input style={inp} type="text" value={editCustForm.contact_name} onChange={e=>setEditCustForm({...editCustForm,contact_name:e.target.value})}/></div>
                <div><label style={lbl}>Phone</label><input style={inp} type="text" value={editCustForm.phone} onChange={e=>setEditCustForm({...editCustForm,phone:e.target.value})}/></div>
                <div><label style={lbl}>Email</label><input style={inp} type="email" value={editCustForm.email} onChange={e=>setEditCustForm({...editCustForm,email:e.target.value})}/></div>
                <div style={{gridColumn:'1/-1'}}><label style={lbl}>Address</label><input style={inp} type="text" value={editCustForm.address} onChange={e=>setEditCustForm({...editCustForm,address:e.target.value})}/></div>
              </div>
              <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                <button onClick={()=>setEditCustomer(null)} style={{background:'transparent',border:'1px solid #334155',color:'#64748b',borderRadius:8,padding:'10px 20px',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:12}}>Cancel</button>
                <button onClick={saveEditCustomer} disabled={saving} style={{...btn(saving),padding:'10px 28px'}}>{saving?'Saving…':'SAVE CHANGES →'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ════ SIMULATOR ════ */}
        {view==='simulator'&&(<div>
          <div className="sec">Discount Simulator</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
            <div style={{...card,padding:18}}>
              <div style={{fontSize:11,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:12}}>STEP 1 — CUSTOMER & EXTRA DISCOUNTS</div>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                <div><label style={lbl}>Customer</label><select style={inp} value={sim.customerId} onChange={e=>setSim({...sim,customerId:e.target.value})}><option value="">Select…</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  <div><label style={lbl}>Extra CN (₹)</label><input style={inp} type="number" placeholder="0" value={sim.extraCN} onChange={e=>setSim({...sim,extraCN:e.target.value})}/></div>
                  <div><label style={lbl}>Extra FOC</label><input style={inp} type="number" placeholder="0" value={sim.extraFOC} onChange={e=>setSim({...sim,extraFOC:e.target.value})}/></div>
                </div>
              </div>
            </div>
            <div style={{...card,padding:18}}>
              <div style={{fontSize:11,color:'#38bdf8',fontFamily:"'DM Mono',monospace",marginBottom:12}}>STEP 2 — NEW PO (OPTIONAL)</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><label style={lbl}>New Qty</label><input style={inp} type="number" placeholder="0" value={sim.newPoQty} onChange={e=>setSim({...sim,newPoQty:e.target.value})}/></div>
                <div><label style={lbl}>Sell Price (₹)</label><input style={inp} type="number" placeholder="0" value={sim.newPoUnitPrice} onChange={e=>setSim({...sim,newPoUnitPrice:e.target.value})}/></div>
                <div><label style={lbl}>Purchase Price (₹)</label><input style={inp} type="number" value={sim.newPoPurchasePrice} onChange={e=>setSim({...sim,newPoPurchasePrice:e.target.value})}/></div>
                <div><label style={lbl}>CN on New PO (₹)</label><input style={inp} type="number" placeholder="0" value={sim.newPoCNAmount} onChange={e=>setSim({...sim,newPoCNAmount:e.target.value})}/></div>
                <div><label style={lbl}>FOC on New PO</label><input style={inp} type="number" placeholder="0" value={sim.newPoFOCUnits} onChange={e=>setSim({...sim,newPoFOCUnits:e.target.value})}/></div>
              </div>
            </div>
          </div>
          {simResult&&(<div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14}}>
            {[['Current — '+simResult.cust.name,[['Net Sales',fmtL(simResult.cust.netSales),'#38bdf8'],['Cost',fmtL(simResult.cust.purchCost),'#94a3b8'],['Profit',fmtL(simResult.cust.profit),simResult.cust.profit>=0?'#34d399':'#f87171'],['Margin',pct(simResult.cust.margin),'#94a3b8'],['Avg SP',fmtC(simResult.cust.avgSP),'#f59e0b'],['Avg PP',fmtC(simResult.cust.avgPP),'#94a3b8']],'#f59e0b'],
              ...(simResult.hasNew?[['New PO Standalone',[['Qty',simResult.nq,'#e2e8f0'],['Revenue',fmtL(simResult.nq*simResult.nup),'#38bdf8'],['CN',`−${fmtL(simResult.nCN)}`,'#f87171'],['Cost',fmtL(simResult.nq*simResult.npp),'#94a3b8'],['Profit',fmtL(simResult.nPGP),simResult.nPGP>=0?'#34d399':'#f87171']],'#38bdf8']]:[]),
              ['Combined',[['Total Qty',simResult.cTQ,'#e2e8f0'],['Net Sales',fmtL(simResult.cNS),'#38bdf8'],['Cost',fmtL(simResult.cPC),'#94a3b8'],['Profit',fmtL(simResult.cP),simResult.cP>=0?'#34d399':'#f87171'],['Margin',pct(simResult.cM),'#94a3b8'],['Avg SP',fmtC(simResult.cASP),'#f59e0b'],['Avg PP',fmtC(simResult.cAPP),'#94a3b8']],simResult.willLoss?'#f87171':'#34d399'],
            ].map(([title,rows,hc])=>(
              <div key={title} style={{...card,padding:16,border:`1px solid ${hc}30`}}>
                <div style={{fontSize:10,color:hc,fontFamily:"'DM Mono',monospace",marginBottom:10,textTransform:'uppercase'}}>{title}</div>
                {rows.map(([l,v,c])=><div key={l} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid #1e293b30'}}><span style={{fontSize:11,color:'#64748b'}}>{l}</span><span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:c}}>{v}</span></div>)}
                {title.startsWith('Combined')&&<div style={{marginTop:10}}>{simResult.willLoss?<AlertBox msg="LOSS territory — avg SP < avg PP"/>:<div style={{background:'#052e16',border:'1px solid #14532d',color:'#34d399',borderRadius:6,padding:'6px 10px',fontSize:11,fontFamily:"'DM Mono',monospace"}}>✓ Safe to proceed</div>}</div>}
              </div>
            ))}
          </div>)}
          {!simResult&&<div style={{color:'#475569',fontSize:13,marginTop:8}}>← Select a customer to begin.</div>}
        </div>)}

        {/* ════ MFR CNs ════ */}
        {view==='mfrcn'&&(<div>
          <div className="sec">Manufacturer Credit Notes</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
            {(()=>{ const tCN=mfrCNAnalytics.reduce((s,c)=>s+Number(c.total_value),0),tU=mfrCNAnalytics.reduce((s,c)=>s+c.totalUsed,0),tB=mfrCNAnalytics.reduce((s,c)=>s+c.balance,0); return [
              {label:'Total Mfr CNs',val:fmtL(tCN),color:'#34d399'},
              {label:'Expenses Booked',val:fmtL(tU),color:'#f87171'},
              {label:'Available Balance',val:fmtL(tB),color:tB>=0?'#f59e0b':'#f87171'},
              {label:'No. of CNs',val:mfrCNs.length,color:'#94a3b8'},
            ];})().map(k=><KPICard key={k.label} {...k}/>)}
          </div>
          <div style={{...card,padding:18,marginBottom:16}}>
            <div style={{fontSize:11,color:'#34d399',fontFamily:"'DM Mono',monospace",marginBottom:12}}>+ NEW MANUFACTURER CN</div>
            <div style={{...g4}}>
              <div><label style={lbl}>CN Ref *</label><input style={inp} type="text" value={mfrCNForm.cn_ref} onChange={e=>setMfrCNForm({...mfrCNForm,cn_ref:e.target.value})}/></div>
              <div><label style={lbl}>Date *</label><input style={inp} type="date" value={mfrCNForm.cn_date} onChange={e=>setMfrCNForm({...mfrCNForm,cn_date:e.target.value})}/></div>
              <div><label style={lbl}>Total Value (₹) *</label><input style={inp} type="number" value={mfrCNForm.total_value} onChange={e=>setMfrCNForm({...mfrCNForm,total_value:e.target.value})}/></div>
              <div><label style={lbl}>Description</label><input style={inp} type="text" value={mfrCNForm.description} onChange={e=>setMfrCNForm({...mfrCNForm,description:e.target.value})}/></div>
            </div>
            <button onClick={addMfrCN} disabled={saving} style={{...btn(false,'#34d399','#0a0e1a'),marginTop:12}}>{saving?'Saving…':'ADD →'}</button>
          </div>
          <div style={{...card,padding:18,marginBottom:16}}>
            <div style={{fontSize:11,color:'#f87171',fontFamily:"'DM Mono',monospace",marginBottom:12}}>+ BOOK EXPENSE AGAINST CN</div>
            <div style={{...g4,marginBottom:10}}>
              <div><label style={lbl}>Manufacturer CN *</label><select style={inp} value={expForm.mfr_cn_id} onChange={e=>setExpForm({...expForm,mfr_cn_id:e.target.value})}><option value="">Select CN…</option>{mfrCNAnalytics.map(c=><option key={c.id} value={c.id}>{c.cn_ref} — Bal: {fmtL(c.balance)}</option>)}</select></div>
              <div><label style={lbl}>Expense Name *</label><input style={inp} type="text" value={expForm.expense_name} onChange={e=>setExpForm({...expForm,expense_name:e.target.value})}/></div>
              <div><label style={lbl}>Date *</label><input style={inp} type="date" value={expForm.expense_date} onChange={e=>setExpForm({...expForm,expense_date:e.target.value})}/></div>
              <div><label style={lbl}>Amount excl. GST *</label><input style={inp} type="number" value={expForm.amount} onChange={e=>setExpForm({...expForm,amount:e.target.value})}/></div>
              <div><label style={lbl}>GST Rate</label><select style={inp} value={expForm.gst_rate} onChange={e=>setExpForm({...expForm,gst_rate:e.target.value})}>{GST_RATES.map(r=><option key={r} value={r}>{r}%</option>)}</select></div>
              <div><label style={lbl}>Vendor</label><input style={inp} type="text" value={expForm.vendor_name} onChange={e=>setExpForm({...expForm,vendor_name:e.target.value})}/></div>
              <div><label style={lbl}>Invoice Ref</label><input style={inp} type="text" value={expForm.invoice_ref} onChange={e=>setExpForm({...expForm,invoice_ref:e.target.value})}/></div>
              <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={addMfrExpense} disabled={saving} style={{...btn(saving,'#dc2626','#fff'),width:'100%',padding:'11px 0'}}>{saving?'Saving…':'BOOK →'}</button></div>
            </div>
          </div>
          {mfrCNAnalytics.map(cn=>(
            <div key={cn.id} style={{...card,marginBottom:10,overflow:'hidden'}}>
              <div style={{display:'flex',alignItems:'center',gap:12,padding:'12px 18px',borderBottom:expandedMfrCN===cn.id?'1px solid #1e293b':'none'}}>
                <div style={{cursor:'pointer',flex:1,display:'flex',alignItems:'center',gap:12}} onClick={()=>setExpandedMfrCN(expandedMfrCN===cn.id?null:cn.id)}>
                  <div style={{fontFamily:"'DM Mono',monospace",color:'#34d399',fontSize:13,fontWeight:500}}>{cn.cn_ref}</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{cn.cn_date}</div>
                  {cn.description&&<div style={{fontSize:11,color:'#94a3b8'}}>{cn.description}</div>}
                  <div style={{marginLeft:'auto',display:'flex',gap:18,alignItems:'center'}}>
                    {[['Total',cn.total_value,'#34d399'],['Used',cn.totalUsed,'#f87171'],['Balance',cn.balance,cn.balance>=0?'#f59e0b':'#f87171']].map(([l,v,c])=><div key={l} style={{textAlign:'right'}}><div style={{fontSize:9,color:'#64748b'}}>{l}</div><div style={{fontFamily:"'DM Mono',monospace",color:c,fontWeight:l==='Balance'?600:400}}>{fmtL(v)}</div></div>)}
                    <div style={{width:70}}><div style={{height:3,background:'#1e293b',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(100,(cn.totalUsed/cn.total_value)*100)}%`,background:'#f59e0b',borderRadius:2}}/></div></div>
                    <div style={{color:'#475569',fontSize:12}}>{expandedMfrCN===cn.id?'▲':'▼'}</div>
                  </div>
                </div>
                <button onClick={e=>{e.stopPropagation();askDelete('mfrcn',cn.id,`Mfr CN ${cn.cn_ref}`,()=>deleteMfrCN(cn.id));}} style={{background:'#1e293b',border:'1px solid #334155',color:'#f87171',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace",flexShrink:0}}>🗑</button>
              </div>
              {expandedMfrCN===cn.id&&(cn.expenses.length===0
                ?<div style={{padding:'12px 18px',color:'#475569',fontSize:12}}>No expenses yet.</div>
                :<table><thead><tr>{['Expense','Date','Base','GST%','GST','Total','Vendor','Ref',''].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{cn.expenses.map(e=><tr key={e.id}>
                  <td style={{fontWeight:500}}>{e.expense_name}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:10}}>{e.expense_date}</td>
                  <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(e.amount)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#94a3b8'}}>{e.gst_rate}%</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171'}}>{fmtL(e.gst_amount)}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#f87171',fontWeight:600}}>{fmtL(e.total_amount)}</td>
                  <td style={{color:'#94a3b8',fontSize:10}}>{e.vendor_name||'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:10}}>{e.invoice_ref||'—'}</td>
                  <td><button onClick={()=>askDelete('mfrexp',e.id,`${e.expense_name} — ${fmtL(e.total_amount)}`,()=>deleteMfrExp(e.id))} style={{background:'#1e293b',border:'1px solid #334155',color:'#f87171',borderRadius:6,padding:'3px 7px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace"}}>🗑</button></td>
                </tr>)}</tbody></table>
              )}
            </div>
          ))}
        </div>)}

        {/* ════ VENDORS ════ */}
        {view==='vendors'&&(<div>
          <div className="sec">Vendor Master</div>
          <div style={{...card,padding:20,marginBottom:16}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
              <div style={{fontSize:11,color:'#c8a96e',fontFamily:"'DM Mono',monospace"}}>+ ADD VENDOR</div>
              <button onClick={()=>setVendorForm({name:MANUFACTURER.name,vendor_type:'Manufacturer',gstin:MANUFACTURER.gstin,contact_name:'',phone:'',email:'P.gandhi@wattpower.in',address:MANUFACTURER.address,notes:'Primary MSA manufacturer'})} style={{...btn(false,'#1a1a2e','#c8a96e'),border:'1px solid #1a1a2e',fontSize:9,padding:'5px 10px'}}>⚡ FILL WATTPOWER</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:10}}>
              <div><label style={lbl}>Vendor Name *</label><input style={inp} type="text" placeholder="Company name" value={vendorForm.name} onChange={e=>setVendorForm({...vendorForm,name:e.target.value})}/></div>
              <div><label style={lbl}>Type *</label><select style={inp} value={vendorForm.vendor_type} onChange={e=>setVendorForm({...vendorForm,vendor_type:e.target.value})}>{VENDOR_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
              <div><label style={lbl}>GSTIN</label><input style={inp} type="text" value={vendorForm.gstin} onChange={e=>setVendorForm({...vendorForm,gstin:e.target.value})}/></div>
              <div><label style={lbl}>Contact Person</label><input style={inp} type="text" value={vendorForm.contact_name} onChange={e=>setVendorForm({...vendorForm,contact_name:e.target.value})}/></div>
              <div><label style={lbl}>Phone</label><input style={inp} type="text" value={vendorForm.phone} onChange={e=>setVendorForm({...vendorForm,phone:e.target.value})}/></div>
              <div><label style={lbl}>Email</label><input style={inp} type="email" value={vendorForm.email} onChange={e=>setVendorForm({...vendorForm,email:e.target.value})}/></div>
              <div><label style={lbl}>Address</label><input style={inp} type="text" value={vendorForm.address} onChange={e=>setVendorForm({...vendorForm,address:e.target.value})}/></div>
              <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={addVendor} disabled={saving} style={{...btn(saving),width:'100%',padding:'11px 0'}}>{saving?'Saving…':'ADD →'}</button></div>
            </div>
          </div>
          {VENDOR_TYPES.map(type=>{
            const typeVendors=vendors.filter(v=>v.vendor_type===type);
            if (!typeVendors.length) return null;
            const typeColors={'Manufacturer':'#34d399','Transporter':'#38bdf8','Installer':'#a78bfa','Service Provider':'#f59e0b','Other':'#64748b'};
            return <div key={type} style={{marginBottom:16}}>
              <div style={{fontSize:11,color:typeColors[type],fontFamily:"'DM Mono',monospace",marginBottom:8,display:'flex',alignItems:'center',gap:6}}><div style={{width:8,height:8,borderRadius:'50%',background:typeColors[type]}}/>{type.toUpperCase()} ({typeVendors.length})</div>
              <div style={{...card,overflow:'auto'}}>
                <table>
                  <thead><tr>{['Name','GSTIN','Contact','Phone','Email','Address','POs',''].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{typeVendors.map(v=>{
                    const vPOs=pos.filter(p=>p.vendor_name===v.name).length;
                    return <tr key={v.id}>
                      <td style={{fontWeight:500,color:typeColors[type]}}>{v.name}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b',fontSize:10}}>{v.gstin||'—'}</td>
                      <td style={{color:'#94a3b8'}}>{v.contact_name||'—'}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#94a3b8',fontSize:11}}>{v.phone||'—'}</td>
                      <td style={{color:'#94a3b8',fontSize:11}}>{v.email||'—'}</td>
                      <td style={{color:'#94a3b8',fontSize:11,maxWidth:160}}>{v.address||'—'}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b'}}>{vPOs}</td>
                      <td><button onClick={()=>askDelete('vendor',v.id,`Vendor: ${v.name}`,()=>deleteVendor(v.id))} style={{background:'#1e293b',border:'1px solid #334155',color:'#f87171',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace"}}>🗑</button></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            </div>;
          })}
          {vendors.length===0&&<div style={{color:'#475569',fontSize:13,padding:20,textAlign:'center'}}>No vendors added yet. Add your first vendor above.</div>}
        </div>)}

        {/* ════ DELIVERIES ════ */}
        {view==='deliveries'&&(<div>
          <div className="sec">Delivery Tracker</div>
          {/* Summary KPIs */}
          {(()=>{
            const openPOs=pos.filter(p=>p.status!=='Delivered / Fulfilled');
            const totalOrdered=openPOs.reduce((s,p)=>s+p.qty,0);
            const totalDelivered=openPOs.reduce((s,p)=>s+deliveries.filter(d=>d.po_id===p.id).reduce((s2,d)=>s2+d.qty_delivered,0),0);
            const totalPending=totalOrdered-totalDelivered;
            const partialPOs=openPOs.filter(p=>{ const d=deliveries.filter(x=>x.po_id===p.id).reduce((s,x)=>s+x.qty_delivered,0); return d>0&&d<p.qty; });
            return <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:20}}>
              <KPICard label="Open POs" val={openPOs.length} color="#f59e0b"/>
              <KPICard label="Total Units Ordered" val={fmt(totalOrdered)} color="#38bdf8"/>
              <KPICard label="Units Delivered" val={fmt(totalDelivered)} color="#34d399"/>
              <KPICard label="Units Pending" val={fmt(totalPending)} sub={`${partialPOs.length} POs partially delivered`} color={totalPending>0?'#fb923c':'#34d399'}/>
            </div>;
          })()}

          {/* Log delivery form */}
          <div style={{...card,padding:18,marginBottom:18}}>
            <div style={{fontSize:12,color:'#34d399',fontFamily:"'DM Mono',monospace",marginBottom:12}}>+ LOG DELIVERY</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,alignItems:'flex-end'}}>
              <div><label style={lbl}>PO *</label>
                <select style={inp} value={deliveryForm.po_id} onChange={e=>setDeliveryForm({...deliveryForm,po_id:e.target.value})}>
                  <option value="">Select open PO…</option>
                  {pos.filter(p=>p.status!=='Delivered / Fulfilled').map(p=>{
                    const cust=customers.find(c=>c.id===p.customer_id);
                    const delivered=deliveries.filter(d=>d.po_id===p.id).reduce((s,d)=>s+d.qty_delivered,0);
                    const rem=p.qty-delivered;
                    return <option key={p.id} value={p.id}>{p.id} — {cust?.name} ({rem} remaining)</option>;
                  })}
                </select>
              </div>
              <div><label style={lbl}>Delivery Date *</label><input style={inp} type="date" value={deliveryForm.delivery_date} onChange={e=>setDeliveryForm({...deliveryForm,delivery_date:e.target.value})}/></div>
              <div><label style={lbl}>Qty Delivered *</label><input style={inp} type="number" min="1" value={deliveryForm.qty_delivered} onChange={e=>setDeliveryForm({...deliveryForm,qty_delivered:e.target.value})}/></div>
              <div><label style={lbl}>Notes</label><input style={inp} type="text" value={deliveryForm.notes} onChange={e=>setDeliveryForm({...deliveryForm,notes:e.target.value})}/></div>
              <div style={{gridColumn:'1/-1',display:'flex',justifyContent:'flex-end'}}>
                <button onClick={addDelivery} disabled={saving} style={{...btn(saving,'#34d399','#0a0e1a'),padding:'10px 28px'}}>{saving?'Saving…':'LOG DELIVERY →'}</button>
              </div>
            </div>
          </div>

          {/* Per-PO delivery status */}
          <div className="sec">Delivery Status by PO</div>
          {pos.filter(p=>{ const d=deliveries.filter(x=>x.po_id===p.id); return d.length>0||p.status!=='Delivered / Fulfilled'; }).map(p=>{
            const cust=customers.find(c=>c.id===p.customer_id);
            const poDeliveries=deliveries.filter(d=>d.po_id===p.id).sort((a,b)=>a.delivery_date>b.delivery_date?-1:1);
            const delivered=poDeliveries.reduce((s,d)=>s+d.qty_delivered,0);
            const rem=p.qty-delivered;
            const pct2=p.qty>0?Math.min(100,(delivered/p.qty)*100):0;
            return <div key={p.id} style={{...card,marginBottom:10,padding:16}}>
              <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:10}}>
                <div style={{fontFamily:"'DM Mono',monospace",color:'#f59e0b',fontWeight:600}}>{p.id}</div>
                <div style={{fontWeight:500}}>{cust?.name||'—'}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'#64748b'}}>Ordered: <strong style={{color:'#e2e8f0'}}>{p.qty}</strong></div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'#64748b'}}>Delivered: <strong style={{color:'#34d399'}}>{delivered}</strong></div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'#64748b'}}>Balance: <strong style={{color:rem>0?'#fb923c':'#34d399'}}>{rem}</strong></div>
                <div style={{flex:1,height:6,background:'#1e293b',borderRadius:3,overflow:'hidden',marginLeft:8}}>
                  <div style={{height:'100%',width:`${pct2}%`,background:pct2>=100?'#34d399':'#f59e0b',borderRadius:3,transition:'width .3s'}}/>
                </div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:pct2>=100?'#34d399':'#f59e0b'}}>{Math.round(pct2)}%</div>
              </div>
              {poDeliveries.length>0&&<table style={{marginTop:4}}>
                <thead><tr>{['Delivery Date','Qty','Notes',''].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>{poDeliveries.map(d=><tr key={d.id}>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#64748b'}}>{d.delivery_date}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#34d399',fontWeight:600}}>{d.qty_delivered}</td>
                  <td style={{color:'#94a3b8',fontSize:11}}>{d.notes||'—'}</td>
                  <td><button onClick={()=>askDelete('delivery',d.id,`Delivery of ${d.qty_delivered} units on ${d.delivery_date}`,()=>deleteDelivery(d.id,d.po_id,d.qty_delivered))} style={{background:'#1e293b',border:'1px solid #334155',color:'#f87171',borderRadius:6,padding:'3px 7px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace"}}>🗑</button></td>
                </tr>)}</tbody>
              </table>}
              {poDeliveries.length===0&&<div style={{fontSize:11,color:'#475569'}}>No deliveries logged yet.</div>}
            </div>;
          })}
        </div>)}

        {/* ════ PROFORMA INVOICES ════ */}
        {view==='pi'&&(<div>
          <div className="sec">Proforma Invoice Tracker</div>
          {/* KPIs */}
          {(()=>{
            const total=pis.reduce((s,p)=>s+Number(p.total_amount),0);
            const received=pis.reduce((s,p)=>s+Number(p.advance_received),0);
            const pending=pis.filter(p=>p.status!=='Paid'&&p.status!=='Cancelled').reduce((s,p)=>s+Math.max(0,Number(p.advance_due)-Number(p.advance_received)),0);
            const paid=pis.filter(p=>p.status==='Paid').length;
            return <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:20}}>
              <KPICard label="Total PI Value" val={fmtL(total)} color="#c8a96e"/>
              <KPICard label="Advance Received" val={fmtL(received)} color="#7ab87a"/>
              <KPICard label="Advance Pending" val={fmtL(pending)} color={pending>0?'#c47a7a':'#7ab87a'}/>
              <KPICard label="PIs Fully Paid" val={`${paid} / ${pis.length}`} color="#7ab8d4"/>
            </div>;
          })()}
          {/* Add PI form */}
          <div style={{...card,padding:20,marginBottom:16}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
              <div style={{fontSize:11,color:'#c8a96e',fontFamily:"'DM Mono',monospace"}}>+ NEW PROFORMA INVOICE</div>
              <button onClick={()=>setPiForm(f=>({...f,pi_number:nextPINumber()}))} style={{...btn(false,'#1a1a2e','#c8a96e'),border:'1px solid #1a1a2e',fontSize:9,padding:'5px 10px'}}>AUTO NUMBER</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:12}}>
              <div><label style={lbl}>PI Number *</label><input style={inp} type="text" placeholder="BSIPL/PI/0001/25-26" value={piForm.pi_number} onChange={e=>setPiForm({...piForm,pi_number:e.target.value})}/></div>
              <div><label style={lbl}>Customer *</label><select style={inp} value={piForm.customer_id} onChange={e=>setPiForm({...piForm,customer_id:e.target.value})}><option value="">Select…</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label style={lbl}>Linked PO</label><select style={inp} value={piForm.po_id} onChange={e=>setPiForm({...piForm,po_id:e.target.value})}><option value="">None</option>{pos.filter(p=>!piForm.customer_id||p.customer_id===Number(piForm.customer_id)).map(p=><option key={p.id} value={p.id}>{p.id}</option>)}</select></div>
              <div><label style={lbl}>PI Date *</label><input style={inp} type="date" value={piForm.pi_date} onChange={e=>setPiForm({...piForm,pi_date:e.target.value})}/></div>
              <div><label style={lbl}>Taxable Amount (₹)</label><input style={inp} type="number" value={piForm.amount} onChange={e=>{ const a=Number(e.target.value); const g=a*(settings.gst_rate_sales||12)/100; setPiForm({...piForm,amount:e.target.value,gst_amount:g.toFixed(2),total_amount:(a+g).toFixed(2),advance_due:(a+g).toFixed(2)}); }}/></div>
              <div><label style={lbl}>GST ({settings.gst_rate_sales||12}%)</label><input style={inp} type="number" value={piForm.gst_amount} onChange={e=>setPiForm({...piForm,gst_amount:e.target.value,total_amount:(Number(piForm.amount)+Number(e.target.value)).toFixed(2)})}/></div>
              <div><label style={lbl}>Total Amount (₹) *</label><input style={{...inp,borderColor:'#c8a96e'}} type="number" value={piForm.total_amount} onChange={e=>setPiForm({...piForm,total_amount:e.target.value,advance_due:e.target.value})}/></div>
              <div><label style={lbl}>Advance Due (₹)</label><input style={inp} type="number" value={piForm.advance_due} onChange={e=>setPiForm({...piForm,advance_due:e.target.value})}/></div>
              <div><label style={lbl}>Advance Received (₹)</label><input style={inp} type="number" value={piForm.advance_received} onChange={e=>setPiForm({...piForm,advance_received:e.target.value})}/></div>
              <div><label style={lbl}>Advance Date</label><input style={inp} type="date" value={piForm.advance_date} onChange={e=>setPiForm({...piForm,advance_date:e.target.value})}/></div>
              <div><label style={lbl}>Payment Terms</label><input style={inp} type="text" value={piForm.payment_terms} onChange={e=>setPiForm({...piForm,payment_terms:e.target.value})}/></div>
              <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={addPI} disabled={saving} style={{...btn(saving),width:'100%',padding:'10px'}}>{saving?'Saving…':'ADD PI →'}</button></div>
            </div>
          </div>
          {/* PI table */}
          <div style={{...card,overflow:'auto'}}>
            <table>
              <thead><tr>{['PI Number','Customer','Linked PO','Date','Taxable','GST','Total','Advance Due','Received','Balance','Status',''].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{pis.length===0
                ?<tr><td colSpan={12} style={{textAlign:'center',color:'#3a3a5a',padding:24}}>No proforma invoices yet.</td></tr>
                :pis.map(pi=>{
                  const cust=customers.find(c=>c.id===pi.customer_id);
                  const bal=Math.max(0,Number(pi.advance_due)-Number(pi.advance_received));
                  const sc={'Pending':'#c8a96e','Partially Paid':'#7ab8d4','Paid':'#7ab87a','Cancelled':'#5a5a7a'};
                  return <tr key={pi.id}>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#c8a96e',whiteSpace:'nowrap'}}>{pi.pi_number}</td>
                    <td style={{fontWeight:500}}>{cust?.name||'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#5a5a7a',fontSize:11}}>{pi.po_id||'—'}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#5a5a7a'}}>{pi.pi_date}</td>
                    <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(pi.amount)}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#7a7ab8'}}>{fmtL(pi.gst_amount)}</td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:'#7ab8d4',fontWeight:600}}>{fmtL(pi.total_amount)}</td>
                    <td style={{fontFamily:"'DM Mono',monospace"}}>{fmtL(pi.advance_due)}</td>
                    <td style={{fontFamily:"'DM Mono',monospace"}}>
                      <input style={{...inp,width:120,fontSize:11,padding:'3px 8px',color:'#7ab87a'}} type="number" defaultValue={pi.advance_received}
                        onBlur={e=>{ if(Number(e.target.value)!==Number(pi.advance_received)) updatePIField(pi.id,'advance_received',Number(e.target.value)); }}/>
                    </td>
                    <td style={{fontFamily:"'DM Mono',monospace",color:bal>0?'#c47a7a':'#7ab87a',fontWeight:700}}>{fmtL(bal)}</td>
                    <td><span className="chip" style={{color:sc[pi.status],borderColor:sc[pi.status]+'40',background:sc[pi.status]+'15'}}>{pi.status}</span></td>
                    <td><button onClick={()=>askDelete('pi',pi.id,`PI ${pi.pi_number}`,()=>deletePI(pi.id))} style={{background:'#1a1a2e',border:'1px solid #2a2a3a',color:'#c47a7a',borderRadius:2,padding:'4px 8px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace"}}>🗑</button></td>
                  </tr>;
                })}</tbody>
            </table>
          </div>
        </div>)}

        {/* ════ DELIVERY SITES ════ */}
        {view==='sites'&&(<div>
          <div className="sec">Delivery Sites (Ship-To Addresses)</div>
          <div style={{...card,padding:20,marginBottom:16}}>
            <div style={{fontSize:11,color:'#c8a96e',fontFamily:"'DM Mono',monospace",marginBottom:12}}>+ ADD DELIVERY SITE</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:10}}>
              <div><label style={lbl}>Purchase Order *</label>
                <select style={inp} value={siteForm.po_id} onChange={e=>setSiteForm({...siteForm,po_id:e.target.value})}>
                  <option value="">Select PO…</option>
                  {pos.map(p=>{ const c=customers.find(x=>x.id===p.customer_id); return <option key={p.id} value={p.id}>{p.id} — {c?.name} ({p.qty} units)</option>; })}
                </select>
              </div>
              <div><label style={lbl}>Site Name *</label><input style={inp} type="text" placeholder="e.g. Shreeji Yarn Mills" value={siteForm.site_name} onChange={e=>setSiteForm({...siteForm,site_name:e.target.value})}/></div>
              <div><label style={lbl}>Qty *</label><input style={inp} type="number" value={siteForm.qty} onChange={e=>setSiteForm({...siteForm,qty:e.target.value})}/></div>
              <div><label style={lbl}>GSTIN</label><input style={inp} type="text" value={siteForm.gstin} onChange={e=>setSiteForm({...siteForm,gstin:e.target.value})}/></div>
              <div><label style={lbl}>Contact</label><input style={inp} type="text" value={siteForm.contact_name} onChange={e=>setSiteForm({...siteForm,contact_name:e.target.value})}/></div>
              <div><label style={lbl}>Phone</label><input style={inp} type="text" value={siteForm.phone} onChange={e=>setSiteForm({...siteForm,phone:e.target.value})}/></div>
              <div style={{gridColumn:'span 2'}}><label style={lbl}>Address</label><input style={inp} type="text" value={siteForm.address} onChange={e=>setSiteForm({...siteForm,address:e.target.value})}/></div>
              <div style={{gridColumn:'span 3'}}><label style={lbl}>Notes</label><input style={inp} type="text" value={siteForm.notes} onChange={e=>setSiteForm({...siteForm,notes:e.target.value})}/></div>
              <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={addSite} disabled={saving} style={{...btn(saving),width:'100%',padding:'10px'}}>{saving?'Saving…':'ADD →'}</button></div>
            </div>
          </div>
          {/* Group sites by PO */}
          {pos.filter(p=>sites.some(s=>s.po_id===p.id)).map(p=>{
            const cust=customers.find(c=>c.id===p.customer_id);
            const poSites=sites.filter(s=>s.po_id===p.id);
            const allocatedQty=poSites.reduce((s,x)=>s+x.qty,0);
            const unallocated=p.qty-allocatedQty;
            return <div key={p.id} style={{...card,marginBottom:12,padding:16}}>
              <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:12}}>
                <div style={{fontFamily:"'DM Mono',monospace",color:'#c8a96e',fontWeight:600}}>{p.id}</div>
                <div style={{fontWeight:500}}>{cust?.name||'—'}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'#5a5a7a'}}>Total: <strong style={{color:'#e8e8ed'}}>{p.qty} units</strong></div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'#5a5a7a'}}>Allocated: <strong style={{color:'#7ab87a'}}>{allocatedQty}</strong></div>
                {unallocated>0&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'#c8a96e'}}>Unallocated: <strong>{unallocated}</strong></div>}
              </div>
              <table>
                <thead><tr>{['Site Name','Qty','GSTIN','Contact','Phone','Address','Notes',''].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>{poSites.map(s=><tr key={s.id}>
                  <td style={{fontWeight:500,color:'#7ab8d4'}}>{s.site_name}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#c8a96e',fontWeight:600}}>{s.qty}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#5a5a7a',fontSize:10}}>{s.gstin||'—'}</td>
                  <td style={{color:'#8a8aaa',fontSize:11}}>{s.contact_name||'—'}</td>
                  <td style={{fontFamily:"'DM Mono',monospace",color:'#8a8aaa',fontSize:11}}>{s.phone||'—'}</td>
                  <td style={{color:'#8a8aaa',fontSize:11,maxWidth:200}}>{s.address||'—'}</td>
                  <td style={{color:'#5a5a7a',fontSize:11}}>{s.notes||'—'}</td>
                  <td><button onClick={()=>askDelete('site',s.id,`Site: ${s.site_name}`,()=>deleteSite(s.id))} style={{background:'#1a1a2e',border:'1px solid #2a2a3a',color:'#c47a7a',borderRadius:2,padding:'3px 7px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace"}}>🗑</button></td>
                </tr>)}</tbody>
              </table>
            </div>;
          })}
          {!pos.some(p=>sites.some(s=>s.po_id===p.id))&&<div style={{textAlign:'center',color:'#3a3a5a',padding:32,fontSize:13}}>No delivery sites added yet. Add your first site above.</div>}
        </div>)}

        {/* ════ CUSTOMER LEDGER ════ */}
        {view==='ledger'&&(<div>
          <div className="sec">Customer Account Ledger</div>
          {/* Customer selector */}
          <div style={{...card,padding:16,marginBottom:16}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:12,alignItems:'flex-end'}}>
              <div>
                <label style={lbl}>Select Customer</label>
                <select style={inp} value={ledgerCust||''} onChange={e=>setLedgerCust(Number(e.target.value)||null)}>
                  <option value="">Choose a customer…</option>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.customer_code?`[${c.customer_code}] `:''}{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Log Payment Receipt</label>
                <div style={{display:'flex',gap:8}}>
                  <input style={{...inp,flex:1}} type="number" placeholder="Amount (₹)" value={receiptForm.amount} onChange={e=>setReceiptForm({...receiptForm,amount:e.target.value,customer_id:ledgerCust||''})}/>
                  <input style={{...inp,flex:1}} type="date" value={receiptForm.receipt_date} onChange={e=>setReceiptForm({...receiptForm,receipt_date:e.target.value})}/>
                </div>
              </div>
              <button onClick={()=>{ if(!ledgerCust){showToast('Select a customer first');return;} setReceiptForm(f=>({...f,customer_id:ledgerCust})); addReceipt(); }} disabled={saving} style={{...btn(saving,'#7ab87a','#08090f'),padding:'10px 16px'}}>{saving?'…':'LOG RECEIPT →'}</button>
            </div>
          </div>

          {ledgerCust&&(()=>{
            const cust=customers.find(c=>c.id===ledgerCust);
            const custPOs=pos.filter(p=>p.customer_id===ledgerCust);
            const custReceipts=receipts.filter(r=>r.customer_id===ledgerCust);
            const custCNs=cns.filter(c=>c.customer_id===ledgerCust);

            // Build ledger entries: PO invoices + payments + CNs, sorted by date
            const entries=[];
            custPOs.forEach(p=>{
              const fin=poFinancials(p);
              if(fin.invoicedAmt>0) entries.push({date:p.po_date,type:'Invoice',ref:p.id,description:`Invoice — ${fin.deliveredQty} units`,debit:fin.invoicedAmt,credit:0,po:p});
              // Advance already on PO counts as receipt
              if(p.advance>0) entries.push({date:p.po_date,type:'Advance',ref:p.id,description:`Advance received`,debit:0,credit:Number(p.advance)});
            });
            custCNs.forEach(c=>{
              if(c.type==='CNNote') entries.push({date:c.cn_date,type:'Credit Note',ref:`CN-${c.id}`,description:c.note||'Credit Note',debit:0,credit:Number(c.amount),cn:c});
              if(c.type==='FOC') { const po=pos.find(p=>p.id===c.po_id); entries.push({date:c.cn_date,type:'FOC',ref:`FOC-${c.id}`,description:`${c.foc_units} FOC units`,debit:0,credit:c.foc_units*Number(po?.purchase_price||0),cn:c}); }
            });
            custReceipts.forEach(r=>{
              entries.push({date:r.receipt_date,type:'Payment',ref:r.receipt_no||`RCP-${r.id}`,description:r.notes||`${r.payment_mode}${r.reference?` — ${r.reference}`:''}`,debit:0,credit:Number(r.amount),receipt:r});
            });
            entries.sort((a,b)=>a.date>b.date?1:-1);

            // Running balance
            let runBal=0;
            const ledger=entries.map(e=>{ runBal+=e.debit-e.credit; return {...e,balance:runBal}; });

            const totalDebit=entries.reduce((s,e)=>s+e.debit,0);
            const totalCredit=entries.reduce((s,e)=>s+e.credit,0);
            const outstanding=totalDebit-totalCredit;

            return <>
              {/* Customer summary */}
              <div style={{...card,padding:18,marginBottom:16}}>
                <div style={{display:'flex',alignItems:'center',gap:20,flexWrap:'wrap'}}>
                  <div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#3a3a5a',marginBottom:3}}>ACCOUNT</div>
                    <div style={{fontSize:16,fontWeight:500}}>{cust?.name}</div>
                    {cust?.customer_code&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:'#c8a96e'}}>{cust.customer_code}</div>}
                  </div>
                  <div style={{flex:1}}/>
                  {[['Total Invoiced',fmtL(totalDebit),'#7ab8d4'],['Total Received',fmtL(totalCredit),'#7ab87a'],['Outstanding',fmtL(outstanding),outstanding>0?'#c47a7a':'#7ab87a']].map(([l,v,c])=>(
                    <div key={l} style={{textAlign:'right',borderLeft:'1px solid #1a1a2e',paddingLeft:20}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#3a3a5a',marginBottom:3}}>{l}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:18,color:c,fontWeight:600}}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Full ledger receipt form */}
              <div style={{...card,padding:16,marginBottom:16}}>
                <div style={{fontSize:10,color:'#3a3a5a',fontFamily:"'DM Mono',monospace",marginBottom:10}}>LOG DETAILED PAYMENT RECEIPT</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10}}>
                  <div><label style={lbl}>Receipt No.</label><input style={inp} type="text" value={receiptForm.receipt_no} onChange={e=>setReceiptForm({...receiptForm,receipt_no:e.target.value})}/></div>
                  <div><label style={lbl}>Date *</label><input style={inp} type="date" value={receiptForm.receipt_date} onChange={e=>setReceiptForm({...receiptForm,receipt_date:e.target.value,customer_id:ledgerCust})}/></div>
                  <div><label style={lbl}>Amount (₹) *</label><input style={inp} type="number" value={receiptForm.amount} onChange={e=>setReceiptForm({...receiptForm,amount:e.target.value})}/></div>
                  <div><label style={lbl}>Linked PO</label><select style={inp} value={receiptForm.po_id} onChange={e=>setReceiptForm({...receiptForm,po_id:e.target.value})}><option value="">None</option>{custPOs.map(p=><option key={p.id} value={p.id}>{p.id}</option>)}</select></div>
                  <div><label style={lbl}>Payment Mode</label><select style={inp} value={receiptForm.payment_mode} onChange={e=>setReceiptForm({...receiptForm,payment_mode:e.target.value})}>{PAY_MODES.map(m=><option key={m}>{m}</option>)}</select></div>
                  <div style={{gridColumn:'span 2'}}><label style={lbl}>Reference / UTR</label><input style={inp} type="text" value={receiptForm.reference} onChange={e=>setReceiptForm({...receiptForm,reference:e.target.value})}/></div>
                  <div style={{gridColumn:'span 2'}}><label style={lbl}>Notes</label><input style={inp} type="text" value={receiptForm.notes} onChange={e=>setReceiptForm({...receiptForm,notes:e.target.value})}/></div>
                  <div style={{display:'flex',alignItems:'flex-end'}}><button onClick={()=>{ setReceiptForm(f=>({...f,customer_id:ledgerCust})); addReceipt(); }} disabled={saving} style={{...btn(saving,'#7ab87a','#08090f'),width:'100%',padding:'10px'}}>{saving?'Saving…':'LOG →'}</button></div>
                </div>
              </div>

              {/* Ledger table */}
              <div style={{...card,overflow:'auto'}}>
                <div style={{padding:'12px 16px 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#3a3a5a',letterSpacing:'.12em'}}>ACCOUNT STATEMENT</div>
                  <div style={{fontSize:10,color:'#3a3a5a',fontFamily:"'DM Mono',monospace"}}>Dr = amount owed · Cr = amount received</div>
                </div>
                <table>
                  <thead><tr>{['Date','Type','Reference','Description','Dr (Invoiced)','Cr (Received)','Balance',''].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {ledger.length===0&&<tr><td colSpan={8} style={{textAlign:'center',color:'#3a3a5a',padding:24}}>No transactions yet.</td></tr>}
                    {ledger.map((e,i)=><tr key={i} style={{background:e.type==='Invoice'?'#1a1a0a20':e.type==='Payment'?'#0a1a0a20':'transparent'}}>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#5a5a7a',whiteSpace:'nowrap'}}>{e.date}</td>
                      <td><span className="chip" style={{fontSize:9,color:e.type==='Invoice'?'#c8a96e':e.type==='Payment'?'#7ab87a':e.type==='Credit Note'?'#7a7ab8':'#5a5a7a',borderColor:'transparent',background:'transparent'}}>{e.type}</span></td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#c8a96e',fontSize:11}}>{e.ref}</td>
                      <td style={{color:'#8a8aaa',fontSize:12}}>{e.description}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:e.debit>0?'#c47a7a':'#3a3a5a',fontWeight:e.debit>0?600:400}}>{e.debit>0?fmtL(e.debit):'—'}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:e.credit>0?'#7ab87a':'#3a3a5a',fontWeight:e.credit>0?600:400}}>{e.credit>0?fmtL(e.credit):'—'}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:e.balance>0?'#c47a7a':e.balance<0?'#7ab87a':'#5a5a7a',fontWeight:700}}>{e.balance>0?`${fmtL(e.balance)} Dr`:e.balance<0?`${fmtL(Math.abs(e.balance))} Cr`:'NIL'}</td>
                      <td>{e.receipt&&<button onClick={()=>askDelete('receipt',e.receipt.id,`Receipt ${e.receipt.receipt_no||e.receipt.id}`,()=>deleteReceipt(e.receipt.id))} style={{background:'#1a1a2e',border:'1px solid #2a2a3a',color:'#c47a7a',borderRadius:2,padding:'3px 7px',cursor:'pointer',fontSize:10,fontFamily:"'DM Mono',monospace"}}>🗑</button>}</td>
                    </tr>)}
                    {/* Totals row */}
                    {ledger.length>0&&<tr style={{borderTop:'2px solid #1a1a2e'}}>
                      <td colSpan={4} style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:'#3a3a5a',padding:'10px 12px'}}>TOTAL</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#c47a7a',fontWeight:700}}>{fmtL(totalDebit)}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:'#7ab87a',fontWeight:700}}>{fmtL(totalCredit)}</td>
                      <td style={{fontFamily:"'DM Mono',monospace",color:outstanding>0?'#c47a7a':'#7ab87a',fontWeight:700,fontSize:13}}>{outstanding>0?`${fmtL(outstanding)} Dr`:outstanding<0?`${fmtL(Math.abs(outstanding))} Cr`:'NIL'}</td>
                      <td/>
                    </tr>}
                  </tbody>
                </table>
              </div>
            </>;
          })()}
          {!ledgerCust&&<div style={{textAlign:'center',color:'#3a3a5a',padding:48,fontSize:13,fontFamily:"'DM Mono',monospace"}}>← Select a customer to view their account statement</div>}
        </div>)}

        {/* ════ SETTINGS ════ */}
        {view==='settings'&&(<div>
          <div className="sec">Settings</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:18}}>
            <div style={{...card,padding:22}}>
              <div style={{fontSize:11,color:'#f59e0b',fontFamily:"'DM Mono',monospace",marginBottom:14}}>MSA PRICES & GST RATE</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                <div><label style={lbl}>EXW Purchase Price (₹)</label><input style={inp} type="number" value={settingsForm.exw} onChange={e=>setSettingsForm({...settingsForm,exw:e.target.value})}/><div style={{fontSize:10,color:'#475569',marginTop:3}}>Active: {fmtC(settings.default_purchase_price_exw)}</div></div>
                <div><label style={lbl}>DDP Purchase Price (₹)</label><input style={inp} type="number" value={settingsForm.ddp} onChange={e=>setSettingsForm({...settingsForm,ddp:e.target.value})}/><div style={{fontSize:10,color:'#475569',marginTop:3}}>Active: {fmtC(settings.default_purchase_price_ddp)}</div></div>
              </div>
              <div style={{marginBottom:16}}>
                <label style={lbl}>GST Rate on Sales (%)</label>
                <select style={{...inp,maxWidth:200}} value={settingsForm.gst_rate} onChange={e=>setSettingsForm({...settingsForm,gst_rate:e.target.value})}>
                  {GST_RATES.map(r=><option key={r} value={r}>{r}%</option>)}
                </select>
                <div style={{fontSize:10,color:'#475569',marginTop:3}}>Active: {settings.gst_rate_sales||12}% — used in GST Summary for output tax calculation</div>
              </div>
              <button onClick={saveSettings} disabled={saving} style={btn(saving)}>{saving?'Saving…':'SAVE →'}</button>
            </div>
            <div style={{...card,padding:22}}>
              <div style={{fontSize:11,color:'#38bdf8',fontFamily:"'DM Mono',monospace",marginBottom:14}}>ANNUAL TARGETS</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                <div><label style={lbl}>FY Label *</label><input style={inp} type="text" placeholder="FY 2025-26" value={targetForm.fy_label} onChange={e=>setTargetForm({...targetForm,fy_label:e.target.value})}/></div>
                <div><label style={lbl}>FY Start *</label><input style={inp} type="date" value={targetForm.fy_start} onChange={e=>setTargetForm({...targetForm,fy_start:e.target.value})}/></div>
                <div><label style={lbl}>FY End *</label><input style={inp} type="date" value={targetForm.fy_end} onChange={e=>setTargetForm({...targetForm,fy_end:e.target.value})}/></div>
                <div><label style={lbl}>Target Units *</label><input style={inp} type="number" value={targetForm.target_units} onChange={e=>setTargetForm({...targetForm,target_units:e.target.value})}/></div>
                <div><label style={lbl}>Target Revenue (₹) *</label><input style={inp} type="number" value={targetForm.target_value} onChange={e=>setTargetForm({...targetForm,target_value:e.target.value})}/></div>
                <div><label style={lbl}>Target Profit (₹)</label><input style={inp} type="number" value={targetForm.target_profit} onChange={e=>setTargetForm({...targetForm,target_profit:e.target.value})}/></div>
                <div><label style={lbl}>Mfr Slab 1 — Units</label><input style={inp} type="number" value={targetForm.mfr_slab_1_units} onChange={e=>setTargetForm({...targetForm,mfr_slab_1_units:e.target.value})}/></div>
                <div><label style={lbl}>Mfr Slab 1 — Bonus (₹)</label><input style={inp} type="number" value={targetForm.mfr_slab_1_bonus} onChange={e=>setTargetForm({...targetForm,mfr_slab_1_bonus:e.target.value})}/></div>
                <div><label style={lbl}>Mfr Slab 2 — Units</label><input style={inp} type="number" value={targetForm.mfr_slab_2_units} onChange={e=>setTargetForm({...targetForm,mfr_slab_2_units:e.target.value})}/></div>
                <div><label style={lbl}>Mfr Slab 2 — Bonus (₹)</label><input style={inp} type="number" value={targetForm.mfr_slab_2_bonus} onChange={e=>setTargetForm({...targetForm,mfr_slab_2_bonus:e.target.value})}/></div>
              </div>
              <button onClick={saveTarget} disabled={saving} style={{...btn(saving,'#38bdf8','#0a0e1a')}}>{saving?'Saving…':'SAVE TARGET →'}</button>
              {targets.length>0&&<div style={{marginTop:12}}>{targets.map(t=><div key={t.id} style={{fontSize:11,color:'#64748b',padding:'3px 0',borderBottom:'1px solid #1e293b'}}>{t.fy_label} — {fmt(t.target_units)} units · {fmtL(t.target_value)}</div>)}</div>}
            </div>
          </div>
        </div>)}

        </>)}
      </div>
    </div>
  );
}
