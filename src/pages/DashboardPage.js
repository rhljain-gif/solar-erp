import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';

// ── Constants ────────────────────────────────────────────────────────────────
const PURCHASE_EXW = 400000;
const PURCHASE_DDP = 403000;

// ── Formatters ───────────────────────────────────────────────────────────────
const fmt  = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
const fmtC = n => '₹' + fmt(n);
const pct  = n => isFinite(n) ? n.toFixed(2) + '%' : '—';

// ── Small UI components ──────────────────────────────────────────────────────
const StatusBadge = ({ s }) => {
  const map = {
    'Fulfilled':       'bg-e/fulfilled',
    'In Transit':      'bg-e/transit',
    'Advance Pending': 'bg-e/pending',
  };
  const colorMap = {
    'Fulfilled':       { background:'#052e16', color:'#34d399', border:'1px solid #14532d' },
    'In Transit':      { background:'#451a03', color:'#fb923c', border:'1px solid #7c2d12' },
    'Advance Pending': { background:'#450a0a', color:'#f87171', border:'1px solid #7f1d1d' },
  };
  const s2 = colorMap[s] || { background:'#1e293b', color:'#94a3b8', border:'1px solid #334155' };
  return <span style={{ ...s2, fontSize:11, padding:'2px 8px', borderRadius:6, fontFamily:"'DM Mono',monospace" }}>{s}</span>;
};

const Alert = ({ msg }) => (
  <div style={{ display:'flex', alignItems:'center', gap:8, background:'#450a0a', border:'1px solid #7f1d1d', color:'#f87171', borderRadius:8, padding:'10px 14px', fontSize:12, fontFamily:"'DM Mono',monospace" }}>
    <span style={{ fontSize:16 }}>⚠</span> {msg}
  </div>
);

const Spinner = () => (
  <div style={{ textAlign:'center', padding:40, color:'#475569', fontFamily:"'DM Mono',monospace", fontSize:13 }}>
    Loading…
  </div>
);

// ── Main App ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user, signOut } = useAuth();

  const [view, setView]           = useState('dashboard');
  const [customers, setCustomers] = useState([]);
  const [pos, setPos]             = useState([]);
  const [cns, setCns]             = useState([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);

  // Forms
  const [poForm, setPoForm]     = useState({ customer_id:'', delivery_type:'DDP', qty:'', unit_price:'', advance:'', po_date:'', status:'Advance Pending' });
  const [cnForm, setCnForm]     = useState({ po_id:'', type:'CNNote', amount:'', foc_units:'', cn_date:'', note:'' });
  const [custForm, setCustForm] = useState({ name:'', gstin:'' });
  const [sim, setSim]           = useState({ customerId:'', extraCN:'', extraFOC:'' });
  const [toast, setToast]       = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // ── Fetch all data ──────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: p }, { data: cn }] = await Promise.all([
      supabase.from('customers').select('*').order('id'),
      supabase.from('purchase_orders').select('*').order('created_at'),
      supabase.from('credit_notes').select('*').order('created_at'),
    ]);
    setCustomers(c || []);
    setPos(p || []);
    setCns(cn || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Add Customer ────────────────────────────────────────────────────────────
  const addCustomer = async () => {
    if (!custForm.name) return;
    setSaving(true);
    const { error } = await supabase.from('customers').insert([custForm]);
    if (error) { showToast('Error: ' + error.message); }
    else { showToast('Customer added ✓'); setCustForm({ name:'', gstin:'' }); await fetchAll(); }
    setSaving(false);
  };

  // ── Add PO ──────────────────────────────────────────────────────────────────
  const addPO = async () => {
    if (!poForm.customer_id || !poForm.qty || !poForm.unit_price || !poForm.advance || !poForm.po_date) {
      showToast('Please fill all required fields'); return;
    }
    setSaving(true);
    // Get next PO ID
    const { data: idData } = await supabase.rpc('next_po_id');
    const { error } = await supabase.from('purchase_orders').insert([{
      id: idData,
      customer_id: Number(poForm.customer_id),
      delivery_type: poForm.delivery_type,
      qty: Number(poForm.qty),
      unit_price: Number(poForm.unit_price),
      advance: Number(poForm.advance),
      po_date: poForm.po_date,
      status: poForm.status,
    }]);
    if (error) { showToast('Error: ' + error.message); }
    else { showToast('Purchase Order added ✓'); setPoForm({ customer_id:'', delivery_type:'DDP', qty:'', unit_price:'', advance:'', po_date:'', status:'Advance Pending' }); await fetchAll(); }
    setSaving(false);
  };

  // ── Update PO Status ────────────────────────────────────────────────────────
  const updatePOStatus = async (poId, newStatus) => {
    await supabase.from('purchase_orders').update({ status: newStatus }).eq('id', poId);
    await fetchAll();
  };

  // ── Add CN/FOC ──────────────────────────────────────────────────────────────
  const addCN = async () => {
    if (!cnForm.po_id || !cnForm.cn_date) { showToast('Please fill all required fields'); return; }
    const po = pos.find(p => p.id === cnForm.po_id);
    if (!po) return;
    setSaving(true);
    const { data: idData } = await supabase.rpc('next_cn_id');
    const { error } = await supabase.from('credit_notes').insert([{
      id: idData,
      po_id: cnForm.po_id,
      customer_id: po.customer_id,
      type: cnForm.type,
      amount: Number(cnForm.amount || 0),
      foc_units: Number(cnForm.foc_units || 0),
      cn_date: cnForm.cn_date,
      note: cnForm.note,
    }]);
    if (error) { showToast('Error: ' + error.message); }
    else { showToast('Credit Note / FOC added ✓'); setCnForm({ po_id:'', type:'CNNote', amount:'', foc_units:'', cn_date:'', note:'' }); await fetchAll(); }
    setSaving(false);
  };

  // ── Analytics ───────────────────────────────────────────────────────────────
  const analytics = useMemo(() => {
    const totalSalesGross    = pos.reduce((s,p) => s + p.qty * p.unit_price, 0);
    const totalUnits         = pos.reduce((s,p) => s + p.qty, 0);
    const totalAdvances      = pos.reduce((s,p) => s + Number(p.advance), 0);
    const totalCNValue       = cns.filter(c => c.type==='CNNote').reduce((s,c) => s + Number(c.amount), 0);
    const totalFOCUnits      = cns.filter(c => c.type==='FOC').reduce((s,c) => s + c.foc_units, 0);
    const totalFOCCost       = cns.filter(c => c.type==='FOC').reduce((s,c) => {
      const po = pos.find(p => p.id===c.po_id);
      return s + c.foc_units * (po?.delivery_type==='DDP' ? PURCHASE_DDP : PURCHASE_EXW);
    }, 0);
    const totalNetSales      = totalSalesGross - totalCNValue;
    const totalPurchaseCost  = pos.reduce((s,p) => s + p.qty*(p.delivery_type==='DDP'?PURCHASE_DDP:PURCHASE_EXW),0) + totalFOCCost;
    const totalProfit        = totalNetSales - totalPurchaseCost;
    const pendingAdvance     = pos.filter(p=>p.status==='Advance Pending').reduce((s,p)=>s+(p.qty*p.unit_price-p.advance),0);
    const avgSellingPrice    = totalUnits>0 ? totalNetSales/totalUnits : 0;

    const perCustomer = customers.map(cust => {
      const custPOs  = pos.filter(p=>p.customer_id===cust.id);
      const custCNs  = cns.filter(c=>c.customer_id===cust.id);
      const grossSales = custPOs.reduce((s,p)=>s+p.qty*p.unit_price,0);
      const totalQty   = custPOs.reduce((s,p)=>s+p.qty,0);
      const cnVal      = custCNs.filter(c=>c.type==='CNNote').reduce((s,c)=>s+Number(c.amount),0);
      const focUnits   = custCNs.filter(c=>c.type==='FOC').reduce((s,c)=>s+c.foc_units,0);
      const focCost    = custCNs.filter(c=>c.type==='FOC').reduce((s,c)=>{
        const po=pos.find(p=>p.id===c.po_id);
        return s+c.foc_units*(po?.delivery_type==='DDP'?PURCHASE_DDP:PURCHASE_EXW);
      },0);
      const netSales   = grossSales - cnVal;
      const purchCost  = custPOs.reduce((s,p)=>s+p.qty*(p.delivery_type==='DDP'?PURCHASE_DDP:PURCHASE_EXW),0)+focCost;
      const profit     = netSales - purchCost;
      const avgSP      = totalQty>0 ? netSales/totalQty : 0;
      const avgPP      = (totalQty+focUnits)>0 ? purchCost/(totalQty+focUnits) : 0;
      const margin     = netSales>0 ? (profit/netSales)*100 : 0;
      const advance    = custPOs.reduce((s,p)=>s+Number(p.advance),0);
      const pending    = custPOs.filter(p=>p.status==='Advance Pending').reduce((s,p)=>s+(p.qty*p.unit_price-p.advance),0);
      const atRisk     = totalQty>0 && avgSP < avgPP;
      return {...cust, grossSales, totalQty, cnVal, focUnits, focCost, netSales, purchCost, profit, avgSP, avgPP, margin, advance, pending, atRisk};
    });

    return { totalSalesGross, totalUnits, totalAdvances, totalCNValue, totalFOCUnits, totalFOCCost,
             totalNetSales, totalPurchaseCost, totalProfit, pendingAdvance, avgSellingPrice, perCustomer };
  }, [customers, pos, cns]);

  // ── Simulator ───────────────────────────────────────────────────────────────
  const simResult = useMemo(() => {
    if (!sim.customerId) return null;
    const cust = analytics.perCustomer.find(c=>c.id===Number(sim.customerId));
    if (!cust) return null;
    const extraCN    = Number(sim.extraCN||0);
    const extraFOC   = Number(sim.extraFOC||0);
    const focCostExt = extraFOC * PURCHASE_DDP;
    const newNet     = cust.netSales - extraCN;
    const newCost    = cust.purchCost + focCostExt;
    const newProfit  = newNet - newCost;
    const newAvgSP   = cust.totalQty>0 ? newNet/cust.totalQty : 0;
    const newMargin  = newNet>0 ? (newProfit/newNet)*100 : 0;
    const newAvgPP   = (cust.totalQty+cust.focUnits+extraFOC)>0 ? newCost/(cust.totalQty+cust.focUnits+extraFOC) : 0;
    const willLoss   = newAvgSP < newAvgPP;
    return { cust, extraCN, extraFOC, focCostExt, newNet, newCost, newProfit, newAvgSP, newMargin, willLoss };
  }, [sim, analytics]);

  // ── Styles ───────────────────────────────────────────────────────────────────
  const inp  = { width:'100%', background:'#0f172a', border:'1px solid #334155', borderRadius:8, padding:'10px 12px', color:'#e2e8f0', fontSize:13, fontFamily:"'DM Sans',sans-serif", outline:'none' };
  const lbl  = { display:'block', fontSize:11, fontFamily:"'DM Mono',monospace", textTransform:'uppercase', letterSpacing:'0.1em', color:'#64748b', marginBottom:5 };

  const navItems = [
    { key:'dashboard', label:'📊 Dashboard' },
    { key:'pos',       label:'📋 Purchase Orders' },
    { key:'cns',       label:'🔖 Credit Notes / FOC' },
    { key:'customers', label:'👤 Customers' },
    { key:'simulator', label:'🔮 Discount Simulator' },
  ];

  return (
    <div style={{ fontFamily:"'DM Sans','Segoe UI',sans-serif", background:'#0a0e1a', minHeight:'100vh', color:'#e2e8f0' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:6px;} ::-webkit-scrollbar-track{background:#0a0e1a;} ::-webkit-scrollbar-thumb{background:#334155;border-radius:3px;}
        .kpi-card{background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid #334155;border-radius:16px;padding:20px;transition:transform 0.2s,box-shadow 0.2s;}
        .kpi-card:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,0.4);}
        .nav-btn{background:transparent;border:none;cursor:pointer;padding:10px 16px;border-radius:8px;font-size:13px;font-family:'DM Sans',sans-serif;color:#94a3b8;transition:all 0.15s;white-space:nowrap;}
        .nav-btn.active{background:#1e293b;color:#f59e0b;border:1px solid #334155;}
        .nav-btn:hover:not(.active){background:#1e293b50;color:#e2e8f0;}
        table{width:100%;border-collapse:collapse;}
        th{font-size:11px;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;padding:10px 12px;text-align:left;border-bottom:1px solid #1e293b;}
        td{font-size:13px;padding:10px 12px;border-bottom:1px solid #1e293b40;}
        tr:hover td{background:#1e293b50;}
        .sec{font-size:11px;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;margin-bottom:16px;}
        select option{background:#1e293b;}
        input:focus,select:focus{border-color:#f59e0b!important;}
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position:'fixed', top:20, right:20, background:'#052e16', border:'1px solid #14532d', color:'#34d399', padding:'12px 20px', borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:13, zIndex:9999, boxShadow:'0 8px 24px rgba(0,0,0,0.5)' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ background:'linear-gradient(90deg,#0f172a,#1e293b)', borderBottom:'1px solid #1e293b', padding:'0 24px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16, height:60 }}>
          <div style={{ fontSize:22 }}>☀️</div>
          <div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:13, color:'#f59e0b', letterSpacing:'0.1em' }}>SOLAR INVERTER ERP</div>
            <div style={{ fontSize:11, color:'#475569', fontFamily:"'DM Mono',monospace" }}>DISTRIBUTOR MANAGEMENT SYSTEM</div>
          </div>
          <div style={{ marginLeft:'auto', display:'flex', gap:4, alignItems:'center' }}>
            {navItems.map(n => (
              <button key={n.key} className={`nav-btn ${view===n.key?'active':''}`} onClick={()=>setView(n.key)}>{n.label}</button>
            ))}
            <div style={{ width:1, height:24, background:'#1e293b', margin:'0 8px' }} />
            <div style={{ fontSize:12, color:'#475569', fontFamily:"'DM Mono',monospace", marginRight:8 }}>{user?.email}</div>
            <button onClick={signOut} style={{ background:'transparent', border:'1px solid #334155', color:'#64748b', borderRadius:6, padding:'6px 12px', cursor:'pointer', fontSize:12, fontFamily:"'DM Mono',monospace" }}>Sign Out</button>
          </div>
        </div>
      </div>

      <div style={{ padding:'28px', maxWidth:1440, margin:'0 auto' }}>
        {loading ? <Spinner /> : (
          <>
            {/* ═══ DASHBOARD ═══ */}
            {view==='dashboard' && (
              <div>
                <div className="sec">Executive Overview — All Time</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:16, marginBottom:28 }}>
                  {[
                    { label:'Gross Sales',             val:fmtC(analytics.totalSalesGross),   sub:`${fmt(analytics.totalUnits)} units`,                  color:'#f59e0b' },
                    { label:'Net Sales (after CN)',     val:fmtC(analytics.totalNetSales),     sub:`CN deducted: ${fmtC(analytics.totalCNValue)}`,         color:'#38bdf8' },
                    { label:'Total Purchase Cost',      val:fmtC(analytics.totalPurchaseCost), sub:`FOC cost incl: ${fmtC(analytics.totalFOCCost)}`,       color:'#a78bfa' },
                    { label:'Net Profit',               val:fmtC(analytics.totalProfit),       sub:`Margin: ${pct((analytics.totalProfit/analytics.totalNetSales)*100)}`, color:analytics.totalProfit>=0?'#34d399':'#f87171' },
                    { label:'Total Advances Received',  val:fmtC(analytics.totalAdvances),     sub:'from customers',                                       color:'#34d399' },
                    { label:'Pending Collections',      val:fmtC(analytics.pendingAdvance),    sub:'balance due from customers',                           color:analytics.pendingAdvance>0?'#f87171':'#34d399' },
                    { label:'Avg Selling Price / Unit', val:fmtC(analytics.avgSellingPrice),   sub:`EXW ₹${fmt(PURCHASE_EXW)} · DDP ₹${fmt(PURCHASE_DDP)}`,color:'#fb923c' },
                    { label:'FOC Units Given',          val:fmt(analytics.totalFOCUnits),      sub:`Cost borne: ${fmtC(analytics.totalFOCCost)}`,          color:'#e879f9' },
                  ].map(k=>(
                    <div key={k.label} className="kpi-card">
                      <div style={{ fontSize:11, color:'#64748b', fontFamily:"'DM Mono',monospace", textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>{k.label}</div>
                      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:26, fontWeight:500, color:k.color, lineHeight:1 }}>{k.val}</div>
                      <div style={{ fontSize:11, color:'#475569', marginTop:6 }}>{k.sub}</div>
                    </div>
                  ))}
                </div>

                <div className="sec">Customer-wise Profitability</div>
                <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:16, overflow:'hidden', marginBottom:28 }}>
                  <table>
                    <thead><tr>{['Customer','Units','Gross Sales','Credit Notes','FOC Units','Net Sales','Purchase Cost','Net Profit','Margin %','Avg SP','Avg PP','Pending','Alert'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {analytics.perCustomer.map(c=>(
                        <tr key={c.id}>
                          <td style={{ fontWeight:500, color:'#f1f5f9' }}>{c.name}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace" }}>{c.totalQty}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(c.grossSales)}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace", color:'#f87171' }}>{fmtC(c.cnVal)}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace", color:'#e879f9' }}>{c.focUnits}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace", color:'#38bdf8' }}>{fmtC(c.netSales)}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(c.purchCost)}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace", color:c.profit>=0?'#34d399':'#f87171', fontWeight:600 }}>{fmtC(c.profit)}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace", color:c.margin>=0?'#34d399':'#f87171' }}>{pct(c.margin)}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(c.avgSP)}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(c.avgPP)}</td>
                          <td style={{ fontFamily:"'DM Mono',monospace", color:c.pending>0?'#f87171':'#34d399' }}>{fmtC(c.pending)}</td>
                          <td>{c.atRisk
                            ? <span style={{ fontSize:11,background:'#450a0a',color:'#f87171',border:'1px solid #7f1d1d',borderRadius:6,padding:'2px 8px',fontFamily:"'DM Mono',monospace" }}>⚠ AT RISK</span>
                            : <span style={{ fontSize:11,background:'#052e16',color:'#34d399',border:'1px solid #14532d',borderRadius:6,padding:'2px 8px',fontFamily:"'DM Mono',monospace" }}>✓ HEALTHY</span>
                          }</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="sec">Profitability Alerts</div>
                {analytics.perCustomer.filter(c=>c.atRisk).length===0
                  ? <div style={{ color:'#34d399', fontSize:13 }}>✓ All customers are above break-even. No alerts.</div>
                  : analytics.perCustomer.filter(c=>c.atRisk).map(c=>(
                      <Alert key={c.id} msg={`${c.name} — Avg selling price (${fmtC(c.avgSP)}) has fallen BELOW avg purchase cost (${fmtC(c.avgPP)}). You are selling at a loss.`} />
                    ))
                }
              </div>
            )}

            {/* ═══ PURCHASE ORDERS ═══ */}
            {view==='pos' && (
              <div>
                <div className="sec">Purchase Orders</div>
                <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:16, padding:20, marginBottom:24 }}>
                  <div style={{ fontSize:12, color:'#f59e0b', fontFamily:"'DM Mono',monospace", marginBottom:14 }}>+ NEW PURCHASE ORDER</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
                    <div><label style={lbl}>Customer</label>
                      <select style={inp} value={poForm.customer_id} onChange={e=>setPoForm({...poForm,customer_id:e.target.value})}>
                        <option value="">Select…</option>
                        {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div><label style={lbl}>Delivery Type</label>
                      <select style={inp} value={poForm.delivery_type} onChange={e=>setPoForm({...poForm,delivery_type:e.target.value})}>
                        <option value="DDP">DDP — ₹{fmt(PURCHASE_DDP)}/unit</option>
                        <option value="EXW">EXW — ₹{fmt(PURCHASE_EXW)}/unit</option>
                      </select>
                    </div>
                    <div><label style={lbl}>Qty (Units)</label>
                      <input style={inp} type="number" placeholder="e.g. 10" value={poForm.qty} onChange={e=>setPoForm({...poForm,qty:e.target.value})} />
                    </div>
                    <div><label style={lbl}>Unit Selling Price (₹)</label>
                      <input style={inp} type="number" placeholder="e.g. 470000" value={poForm.unit_price} onChange={e=>setPoForm({...poForm,unit_price:e.target.value})} />
                    </div>
                    <div><label style={lbl}>Advance Received (₹)</label>
                      <input style={inp} type="number" placeholder="100% advance" value={poForm.advance} onChange={e=>setPoForm({...poForm,advance:e.target.value})} />
                    </div>
                    <div><label style={lbl}>PO Date</label>
                      <input style={inp} type="date" value={poForm.po_date} onChange={e=>setPoForm({...poForm,po_date:e.target.value})} />
                    </div>
                    <div><label style={lbl}>Status</label>
                      <select style={inp} value={poForm.status} onChange={e=>setPoForm({...poForm,status:e.target.value})}>
                        {['Advance Pending','In Transit','Fulfilled'].map(s=><option key={s}>{s}</option>)}
                      </select>
                    </div>
                    <div style={{ display:'flex', alignItems:'flex-end' }}>
                      <button onClick={addPO} disabled={saving} style={{ width:'100%', background:'#f59e0b', color:'#0a0e1a', fontWeight:700, border:'none', borderRadius:8, padding:'11px 0', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:12, opacity:saving?0.6:1 }}>
                        {saving ? 'Saving…' : 'ADD PO →'}
                      </button>
                    </div>
                  </div>
                  {poForm.qty && poForm.unit_price && (
                    <div style={{ marginTop:12, fontSize:12, color:'#94a3b8', fontFamily:"'DM Mono',monospace" }}>
                      Gross Invoice: {fmtC(poForm.qty*poForm.unit_price)} &nbsp;|&nbsp;
                      My Purchase Cost: {fmtC(poForm.qty*(poForm.delivery_type==='DDP'?PURCHASE_DDP:PURCHASE_EXW))} &nbsp;|&nbsp;
                      Est. Gross Profit: <span style={{ color:(poForm.qty*poForm.unit_price - poForm.qty*(poForm.delivery_type==='DDP'?PURCHASE_DDP:PURCHASE_EXW))>=0?'#34d399':'#f87171' }}>
                        {fmtC(poForm.qty*poForm.unit_price - poForm.qty*(poForm.delivery_type==='DDP'?PURCHASE_DDP:PURCHASE_EXW))}
                      </span>
                    </div>
                  )}
                </div>

                <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:16, overflow:'hidden' }}>
                  <table>
                    <thead><tr>{['PO No','Customer','Type','Qty','Unit Price','Gross Value','Advance Rcvd','Balance Due','Date','Status','Update'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {pos.map(p=>{
                        const cust=customers.find(c=>c.id===p.customer_id);
                        const gross=p.qty*p.unit_price;
                        const bal=gross-p.advance;
                        return (
                          <tr key={p.id}>
                            <td style={{ fontFamily:"'DM Mono',monospace", color:'#f59e0b' }}>{p.id}</td>
                            <td>{cust?.name||'—'}</td>
                            <td><span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, background:p.delivery_type==='DDP'?'#1e3a5f':'#1e3a2f', color:p.delivery_type==='DDP'?'#38bdf8':'#34d399', borderRadius:4, padding:'2px 8px' }}>{p.delivery_type}</span></td>
                            <td style={{ fontFamily:"'DM Mono',monospace" }}>{p.qty}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(p.unit_price)}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(gross)}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace", color:'#34d399' }}>{fmtC(p.advance)}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace", color:bal>0?'#f87171':'#34d399' }}>{fmtC(bal)}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace", color:'#64748b' }}>{p.po_date}</td>
                            <td><StatusBadge s={p.status} /></td>
                            <td>
                              <select style={{ ...inp, width:'auto', fontSize:11, padding:'4px 8px' }} value={p.status} onChange={e=>updatePOStatus(p.id,e.target.value)}>
                                {['Advance Pending','In Transit','Fulfilled'].map(s=><option key={s}>{s}</option>)}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ═══ CREDIT NOTES ═══ */}
            {view==='cns' && (
              <div>
                <div className="sec">Credit Notes & FOC Units</div>
                <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:16, padding:20, marginBottom:24 }}>
                  <div style={{ fontSize:12, color:'#f59e0b', fontFamily:"'DM Mono',monospace", marginBottom:14 }}>+ NEW CREDIT NOTE / FOC</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
                    <div><label style={lbl}>Linked PO</label>
                      <select style={inp} value={cnForm.po_id} onChange={e=>setCnForm({...cnForm,po_id:e.target.value})}>
                        <option value="">Select PO…</option>
                        {pos.map(p=>{const c=customers.find(x=>x.id===p.customer_id); return <option key={p.id} value={p.id}>{p.id} — {c?.name}</option>;})}
                      </select>
                    </div>
                    <div><label style={lbl}>Type</label>
                      <select style={inp} value={cnForm.type} onChange={e=>setCnForm({...cnForm,type:e.target.value})}>
                        <option value="CNNote">Credit Note (Volume Discount)</option>
                        <option value="FOC">FOC Units (Free of Cost)</option>
                      </select>
                    </div>
                    {cnForm.type==='CNNote' && <div><label style={lbl}>CN Amount (₹)</label><input style={inp} type="number" placeholder="e.g. 150000" value={cnForm.amount} onChange={e=>setCnForm({...cnForm,amount:e.target.value})} /></div>}
                    {cnForm.type==='FOC' && <div><label style={lbl}>FOC Units</label><input style={inp} type="number" placeholder="e.g. 1" value={cnForm.foc_units} onChange={e=>setCnForm({...cnForm,foc_units:e.target.value})} /></div>}
                    <div><label style={lbl}>Date</label><input style={inp} type="date" value={cnForm.cn_date} onChange={e=>setCnForm({...cnForm,cn_date:e.target.value})} /></div>
                    <div><label style={lbl}>Note / Remarks</label><input style={inp} type="text" placeholder="e.g. Q1 volume rebate" value={cnForm.note} onChange={e=>setCnForm({...cnForm,note:e.target.value})} /></div>
                    <div style={{ display:'flex', alignItems:'flex-end' }}>
                      <button onClick={addCN} disabled={saving} style={{ width:'100%', background:'#f59e0b', color:'#0a0e1a', fontWeight:700, border:'none', borderRadius:8, padding:'11px 0', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:12, opacity:saving?0.6:1 }}>
                        {saving ? 'Saving…' : 'ADD →'}
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:16, overflow:'hidden' }}>
                  <table>
                    <thead><tr>{['CN/FOC No','Linked PO','Customer','Type','CN Amount','FOC Units','FOC Cost (to me)','Date','Remarks'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {cns.map(c=>{
                        const cust=customers.find(x=>x.id===c.customer_id);
                        const po=pos.find(p=>p.id===c.po_id);
                        const focCost=c.type==='FOC'?c.foc_units*(po?.delivery_type==='DDP'?PURCHASE_DDP:PURCHASE_EXW):0;
                        return (
                          <tr key={c.id}>
                            <td style={{ fontFamily:"'DM Mono',monospace", color:'#f59e0b' }}>{c.id}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace" }}>{c.po_id}</td>
                            <td>{cust?.name||'—'}</td>
                            <td><span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, background:c.type==='CNNote'?'#2d1f3d':'#1f2d1f', color:c.type==='CNNote'?'#c084fc':'#4ade80', borderRadius:4, padding:'2px 8px' }}>{c.type==='CNNote'?'Credit Note':'FOC'}</span></td>
                            <td style={{ fontFamily:"'DM Mono',monospace", color:'#f87171' }}>{c.type==='CNNote'?fmtC(c.amount):'—'}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace", color:'#e879f9' }}>{c.type==='FOC'?c.foc_units:'—'}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace", color:'#f87171' }}>{c.type==='FOC'?fmtC(focCost):'—'}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace", color:'#64748b' }}>{c.cn_date}</td>
                            <td style={{ color:'#94a3b8', fontSize:12 }}>{c.note}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ═══ CUSTOMERS ═══ */}
            {view==='customers' && (
              <div>
                <div className="sec">Customer Master</div>
                <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:16, padding:20, marginBottom:24 }}>
                  <div style={{ fontSize:12, color:'#f59e0b', fontFamily:"'DM Mono',monospace", marginBottom:14 }}>+ ADD CUSTOMER</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:14, alignItems:'flex-end' }}>
                    <div><label style={lbl}>Customer Name</label><input style={inp} type="text" placeholder="Company name" value={custForm.name} onChange={e=>setCustForm({...custForm,name:e.target.value})} /></div>
                    <div><label style={lbl}>GSTIN</label><input style={inp} type="text" placeholder="27AABCS1429B1ZB" value={custForm.gstin} onChange={e=>setCustForm({...custForm,gstin:e.target.value})} /></div>
                    <button onClick={addCustomer} disabled={saving} style={{ background:'#f59e0b', color:'#0a0e1a', fontWeight:700, border:'none', borderRadius:8, padding:'11px 20px', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:12, whiteSpace:'nowrap', opacity:saving?0.6:1 }}>
                      {saving ? 'Saving…' : 'ADD →'}
                    </button>
                  </div>
                </div>
                <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:16, overflow:'hidden' }}>
                  <table>
                    <thead><tr>{['#','Customer Name','GSTIN','Total POs','Net Sales','Net Profit','Margin','Status'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {customers.map((c,i)=>{
                        const a=analytics.perCustomer.find(x=>x.id===c.id);
                        return (
                          <tr key={c.id}>
                            <td style={{ fontFamily:"'DM Mono',monospace", color:'#64748b' }}>{i+1}</td>
                            <td style={{ fontWeight:500, color:'#f1f5f9' }}>{c.name}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace", color:'#64748b', fontSize:12 }}>{c.gstin||'—'}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace" }}>{pos.filter(p=>p.customer_id===c.id).length}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace" }}>{fmtC(a?.netSales||0)}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace", color:(a?.profit||0)>=0?'#34d399':'#f87171' }}>{fmtC(a?.profit||0)}</td>
                            <td style={{ fontFamily:"'DM Mono',monospace" }}>{pct(a?.margin||0)}</td>
                            <td>{a?.atRisk
                              ? <span style={{ fontSize:11,background:'#450a0a',color:'#f87171',border:'1px solid #7f1d1d',borderRadius:6,padding:'2px 8px',fontFamily:"'DM Mono',monospace" }}>⚠ AT RISK</span>
                              : <span style={{ fontSize:11,background:'#052e16',color:'#34d399',border:'1px solid #14532d',borderRadius:6,padding:'2px 8px',fontFamily:"'DM Mono',monospace" }}>✓ HEALTHY</span>
                            }</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ═══ SIMULATOR ═══ */}
            {view==='simulator' && (
              <div>
                <div className="sec">Discount Simulator — "What If I Give More?"</div>
                <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:16, padding:24, marginBottom:24, maxWidth:700 }}>
                  <div style={{ fontSize:12, color:'#f59e0b', fontFamily:"'DM Mono',monospace", marginBottom:16 }}>MODEL A FUTURE DISCOUNT / FOC SCENARIO</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                    <div><label style={lbl}>Select Customer</label>
                      <select style={inp} value={sim.customerId} onChange={e=>setSim({...sim,customerId:e.target.value})}>
                        <option value="">Select…</option>
                        {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div><label style={lbl}>Additional CN Amount (₹)</label><input style={inp} type="number" placeholder="e.g. 100000" value={sim.extraCN} onChange={e=>setSim({...sim,extraCN:e.target.value})} /></div>
                    <div><label style={lbl}>Additional FOC Units</label><input style={inp} type="number" placeholder="e.g. 1" value={sim.extraFOC} onChange={e=>setSim({...sim,extraFOC:e.target.value})} /></div>
                  </div>
                </div>
                {simResult && (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, maxWidth:900 }}>
                    <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:16, padding:24 }}>
                      <div style={{ fontSize:11, color:'#64748b', fontFamily:"'DM Mono',monospace", marginBottom:16, textTransform:'uppercase' }}>Current — {simResult.cust.name}</div>
                      {[
                        ['Net Sales',     fmtC(simResult.cust.netSales),  '#38bdf8'],
                        ['Purchase Cost', fmtC(simResult.cust.purchCost), '#94a3b8'],
                        ['Net Profit',    fmtC(simResult.cust.profit),    simResult.cust.profit>=0?'#34d399':'#f87171'],
                        ['Margin',        pct(simResult.cust.margin),     simResult.cust.margin>=0?'#34d399':'#f87171'],
                        ['Avg Sell Price',fmtC(simResult.cust.avgSP),     '#f59e0b'],
                        ['Avg Buy Price', fmtC(simResult.cust.avgPP),     '#94a3b8'],
                      ].map(([l,v,c])=>(
                        <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #1e293b' }}>
                          <span style={{ fontSize:13, color:'#64748b' }}>{l}</span>
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:13, color:c }}>{v}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ background:'#0f172a', border:`1px solid ${simResult.willLoss?'#7f1d1d':'#14532d'}`, borderRadius:16, padding:24 }}>
                      <div style={{ fontSize:11, color:simResult.willLoss?'#f87171':'#34d399', fontFamily:"'DM Mono',monospace", marginBottom:16, textTransform:'uppercase' }}>
                        {simResult.willLoss ? '⚠ AFTER SCENARIO — LOSS TERRITORY' : '✓ AFTER SCENARIO — STILL PROFITABLE'}
                      </div>
                      {[
                        ['Net Sales (after CN)',    fmtC(simResult.newNet),      '#38bdf8'],
                        ['Total Cost (incl FOC)',   fmtC(simResult.newCost),     '#94a3b8'],
                        ['Net Profit',              fmtC(simResult.newProfit),   simResult.newProfit>=0?'#34d399':'#f87171'],
                        ['Margin',                  pct(simResult.newMargin),    simResult.newMargin>=0?'#34d399':'#f87171'],
                        ['Extra CN Impact',         `- ${fmtC(simResult.extraCN)}`,'#f87171'],
                        ['Extra FOC Cost',          `- ${fmtC(simResult.focCostExt)}`,'#f87171'],
                      ].map(([l,v,c])=>(
                        <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #1e293b20' }}>
                          <span style={{ fontSize:13, color:'#64748b' }}>{l}</span>
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:13, color:c }}>{v}</span>
                        </div>
                      ))}
                      <div style={{ marginTop:16 }}>
                        {simResult.willLoss
                          ? <Alert msg={`DO NOT AGREE — giving this will push ${simResult.cust.name} into LOSS. Avg sell price will fall below avg buy price.`} />
                          : <div style={{ background:'#052e16', border:'1px solid #14532d', color:'#34d399', borderRadius:8, padding:'10px 14px', fontSize:12, fontFamily:"'DM Mono',monospace" }}>✓ Safe to proceed — you remain profitable at this level.</div>
                        }
                      </div>
                    </div>
                  </div>
                )}
                {!simResult && <div style={{ color:'#475569', fontSize:13 }}>← Select a customer and enter a proposed discount or FOC quantity to see the instant impact.</div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
