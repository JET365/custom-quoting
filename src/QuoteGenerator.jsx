import { useState, useRef, useCallback, useEffect } from "react";

const BRAND = {
  dark: "#232323",
  gold: "#AB9A76",
  cream: "#FFFAF1",
  white: "#FFFFFF",
  lightGray: "#F7F5F0",
  midGray: "#E8E4DC",
  textMuted: "#8A8578",
};

const LOGO_SRC = "/logo.png";

// PDF text extraction helper (basic approach using pdf.js concepts)
function extractQuoteData(text) {
  const data = {
    aircraft: "",
    registration: "",
    amenities: [],
    legs: [],
    totalPrice: "",
    pax: "",
    notes: "",
  };

  // Aircraft type extraction
  const aircraftPatterns = [
    /AIRCRAFT[:\s]*([^\n]+)/i,
    /Aircraft Type[:\s]*([^\n]+)/i,
    /aircraft[:\s]*([^\n]+)/i,
  ];
  for (const p of aircraftPatterns) {
    const m = text.match(p);
    if (m) { data.aircraft = m[1].trim(); break; }
  }

  // Registration
  const regMatch = text.match(/Reg(?:istration)?[:\s]*([A-Z0-9-]+)/i);
  if (regMatch) data.registration = regMatch[1].trim();

  // Price extraction
  const pricePatterns = [
    /Total[:\s]*\$\s*([\d,]+(?:\.\d{2})?)/i,
    /PRICE[:\s]*\$\s*([\d,]+(?:\.\d{2})?)/i,
    /\$\s*([\d,]+(?:\.\d{2})?)/,
  ];
  for (const p of pricePatterns) {
    const m = text.match(p);
    if (m) { data.totalPrice = m[1].trim(); break; }
  }

  // PAX extraction
  const paxMatch = text.match(/(\d+)\s*PAX/i);
  if (paxMatch) data.pax = paxMatch[1];

  // Amenities
  const amenMatch = text.match(/AMENITIES[:\s]*([^\n]+(?:\n[^\n]*)*?)(?=\n\s*(?:MESSAGE|DATE|Itinerary))/i);
  if (amenMatch) {
    data.amenities = amenMatch[1].split(/[,\n]/).map(a => a.trim()).filter(a => a && a.length > 2);
  }

  // Leg extraction - look for date/airport patterns
  const legPattern = /(\d{2}\/\d{2}\/\d{2})\s+(\d{1,2}:\d{2}\s*[AP]M)\s+([^\n]+?)(?:\s+-\s+|\s*\n\s*)([^\n]*?)(?:\s+(\d+)\s+(\d+:\d{2})\s+(\d+))?/gi;
  let legMatch;
  const rawLegs = [];
  
  // Try structured Avinode format first
  const lines = text.split('\n');
  let currentDate = '';
  let currentDep = '';
  let currentDepAirport = '';
  let currentArr = '';
  let currentArrAirport = '';
  let currentPax = '';
  let currentEte = '';
  let currentNm = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Date pattern: MM/DD/YY
    const dateMatch = line.match(/^(\d{2}\/\d{2}\/\d{2})/);
    if (dateMatch) {
      currentDate = dateMatch[1];
      // Look for time on same line
      const timeMatch = line.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
      if (timeMatch) currentDep = timeMatch[1];
    }
    
    // Airport codes
    const icaoMatch = line.match(/\b([A-Z]{4})\b.*?(?:-|–)\s*/);
    const iataMatch = line.match(/\(([A-Z]{3,4})\)/);
    
    // Time patterns
    const timeMatch = line.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
    
    // PAX/ETE/NM at end of line
    const statsMatch = line.match(/(\d+)\s+(\d+:\d{2})\s+(\d+)\s*$/);
    if (statsMatch) {
      currentPax = statsMatch[1];
      currentEte = statsMatch[2];
      currentNm = statsMatch[3];
    }
  }

  // Simplified: try to extract pairs of airports with dates
  const legRegex = /(\d{2}\/\d{2}\/\d{2})\s+(\d{1,2}:\d{2}\s*[AP]M)\s+(.*?)(\d{1,2}:\d{2}\s*[AP]M)\s+(.*?)(?:(\d+)\s+(\d+:\d{2})\s+(\d+))?/gs;
  
  // Fallback: Extract from structured text blocks
  const dateBlocks = text.split(/(?=\d{2}\/\d{2}\/\d{2})/);
  for (const block of dateBlocks) {
    const dMatch = block.match(/^(\d{2}\/\d{2}\/\d{2})/);
    if (!dMatch) continue;
    
    const times = block.match(/(\d{1,2}:\d{2}\s*[AP]M)/gi) || [];
    const airports = block.match(/([A-Z]{4})\s*(?:\)|[-])/g) || [];
    const airportNames = block.match(/(?:[-–]\s*)([A-Za-z\s]+(?:Intl|Rgnl|Regional|International|Municipal|County|Field|Fld))/gi) || [];
    const paxVals = block.match(/\b(\d{1,2})\s+\d+:\d{2}\s+\d{3}/);
    
    if (times.length >= 2) {
      rawLegs.push({
        date: dMatch[1],
        depTime: times[0],
        arrTime: times[1],
        depAirport: airports[0] ? airports[0].replace(/[)\-]/g, '').trim() : '',
        arrAirport: airports[1] ? airports[1].replace(/[)\-]/g, '').trim() : '',
        depName: airportNames[0] ? airportNames[0].replace(/^[-–]\s*/, '').trim() : '',
        arrName: airportNames[1] ? airportNames[1].replace(/^[-–]\s*/, '').trim() : '',
        pax: paxVals ? paxVals[1] : data.pax || '',
      });
    }
  }

  // Also try KBTV/KPOU style (Wagner format)
  const wagnerLegPattern = /(?:April|January|February|March|May|June|July|August|September|October|November|December)\s+\d+[a-z]*,?\s*\d{4}\s+(K[A-Z]{3})\s+.*?\s+(K[A-Z]{3})\s+.*?(\d{1,2}:\d{2}\s*[ap]m)\s+(\d{1,2}:\d{2}\s*[ap]m)\s+(\d+)/gi;
  let wMatch;
  while ((wMatch = wagnerLegPattern.exec(text)) !== null) {
    rawLegs.push({
      date: '',
      depAirport: wMatch[1],
      arrAirport: wMatch[2],
      depTime: wMatch[3],
      arrTime: wMatch[4],
      pax: wMatch[5],
      depName: '',
      arrName: '',
    });
  }

  data.legs = rawLegs;
  return data;
}

// Format date from MM/DD/YY to readable
function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const m = parseInt(parts[0]) - 1;
  const d = parseInt(parts[1]);
  const y = 2000 + parseInt(parts[2]);
  const suffix = d === 1 || d === 21 || d === 31 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th';
  return `${d} ${months[m]} ${y}`;
}

// Estimate flight time from dep/arr times
function estimateFlightTime(dep, arr) {
  if (!dep || !arr) return '';
  const parseTime = (t) => {
    const m = t.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
    if (!m) return null;
    let h = parseInt(m[1]);
    const min = parseInt(m[2]);
    const ampm = m[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  };
  const d = parseTime(dep);
  const a = parseTime(arr);
  if (d === null || a === null) return '';
  let diff = a - d;
  if (diff < 0) diff += 24 * 60;
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  return `${hours}h ${mins.toString().padStart(2, '0')}m`;
}

// ─── Photo Section Component ────────────────────────────────────
function PhotoSection({ photo, onPhotoChange, onRemove, label, style }) {
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const [zoom, setZoom] = useState(100);
  const containerRef = useRef(null);
  const dragStartRef = useRef(null);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => onPhotoChange(ev.target.result);
      reader.readAsDataURL(file);
    }
  }, [onPhotoChange]);

  const handleFileInput = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => onPhotoChange(ev.target.result);
      reader.readAsDataURL(file);
    }
  }, [onPhotoChange]);

  const handleMouseDown = useCallback((e) => {
    if (!photo) return;
    e.preventDefault();
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };
    const handleMouseMove = (ev) => {
      if (!dragStartRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dx = ((ev.clientX - dragStartRef.current.startX) / rect.width) * 100;
      const dy = ((ev.clientY - dragStartRef.current.startY) / rect.height) * 100;
      setPosition({
        x: Math.max(0, Math.min(100, dragStartRef.current.startPosX + dx)),
        y: Math.max(0, Math.min(100, dragStartRef.current.startPosY + dy)),
      });
    };
    const handleMouseUp = () => {
      dragStartRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [photo, position]);

  const fileInputRef = useRef(null);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: BRAND.lightGray,
        cursor: photo ? 'grab' : 'pointer',
        ...style,
      }}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onMouseDown={handleMouseDown}
      onClick={() => { if (!photo) fileInputRef.current?.click(); }}
    >
      {photo ? (
        <>
          <img
            src={photo}
            alt={label}
            style={{
              position: 'absolute',
              width: `${zoom}%`,
              height: `${zoom}%`,
              objectFit: 'cover',
              left: `${position.x - zoom/2}%`,
              top: `${position.y - zoom/2}%`,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
            draggable={false}
          />
          <div style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            display: 'flex',
            gap: 4,
            zIndex: 10,
          }}>
            <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.max(100, z - 20)); }}
              style={{ ...zoomBtnStyle }}>-</button>
            <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.min(300, z + 20)); }}
              style={{ ...zoomBtnStyle }}>+</button>
            <button onClick={(e) => { e.stopPropagation(); onRemove(); setPosition({ x: 50, y: 50 }); setZoom(100); }}
              style={{ ...zoomBtnStyle, backgroundColor: '#dc2626' }}>✕</button>
          </div>
        </>
      ) : (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: isDragging ? `2px dashed ${BRAND.gold}` : `2px dashed ${BRAND.midGray}`,
          borderRadius: 4,
          margin: 4,
          transition: 'border-color 0.2s',
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={BRAND.textMuted} strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <path d="M21 15l-5-5L5 21"/>
          </svg>
          <span style={{ fontSize: 11, color: BRAND.textMuted, marginTop: 6, letterSpacing: '0.05em' }}>
            {isDragging ? 'DROP IMAGE' : label || 'DROP OR CLICK'}
          </span>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileInput}
        style={{ display: 'none' }} />
    </div>
  );
}

const zoomBtnStyle = {
  width: 28,
  height: 28,
  borderRadius: 4,
  border: 'none',
  backgroundColor: BRAND.dark,
  color: BRAND.white,
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 'bold',
};

// ─── Main App ───────────────────────────────────────────────────
export default function QuoteGenerator() {
  const [mode, setMode] = useState('input'); // 'input' | 'preview'
  const [rawText, setRawText] = useState('');
  const [parsedData, setParsedData] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  
  // Editable fields
  const [clientName, setClientName] = useState('');
  const [quoteNumber, setQuoteNumber] = useState('');
  const [quoteDate, setQuoteDate] = useState(new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }));
  const [aircraft, setAircraft] = useState('');
  const [registration, setRegistration] = useState('');
  const [totalPrice, setTotalPrice] = useState('');
  const [pax, setPax] = useState('');
  const [amenities, setAmenities] = useState('');
  const [message, setMessage] = useState("Thank you for choosing JET365!\n\nWe appreciate the opportunity to assist with your private aviation needs. At JET365, we're dedicated to delivering exceptional service, seamless experiences, and tailored solutions that exceed your expectations.\n\nIf you have any questions or need further assistance, our team is here to help.\n\nSafe travels,\nThe JET365 Team");
  const [legs, setLegs] = useState([]);
  const [fboDetails, setFboDetails] = useState([]);
  
  // Photos
  const [heroPhoto, setHeroPhoto] = useState(null);
  const [cabinPhoto, setCabinPhoto] = useState(null);

  // Parse dropped/uploaded file
  const handleFileDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) return;
    
    setFileName(file.name);

    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      // Read as text (basic extraction)
      const text = await file.text();
      setRawText(text);
      
      // Also try reading as array buffer for better extraction
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const arrayBuffer = ev.target.result;
        // Convert to text representation
        const decoder = new TextDecoder('utf-8', { fatal: false });
        let decoded = decoder.decode(arrayBuffer);
        
        // Clean up binary noise but keep text content
        decoded = decoded.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ');
        
        if (decoded.length > text.length) {
          setRawText(decoded);
          const data = extractQuoteData(decoded);
          applyParsedData(data);
        } else {
          const data = extractQuoteData(text);
          applyParsedData(data);
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
      const text = await file.text();
      setRawText(text);
      const data = extractQuoteData(text);
      applyParsedData(data);
    }
  }, []);

  const applyParsedData = (data) => {
    setParsedData(data);
    if (data.aircraft) setAircraft(data.aircraft);
    if (data.registration) setRegistration(data.registration);
    if (data.totalPrice) setTotalPrice(data.totalPrice);
    if (data.pax) setPax(data.pax);
    if (data.amenities?.length) setAmenities(data.amenities.join(', '));
    if (data.legs?.length) setLegs(data.legs.map((l, i) => ({
      id: Date.now() + i,
      date: l.date || '',
      depAirport: l.depAirport || '',
      depName: l.depName || '',
      arrAirport: l.arrAirport || '',
      arrName: l.arrName || '',
      depTime: l.depTime || '',
      arrTime: l.arrTime || '',
      pax: l.pax || data.pax || '',
      ete: l.ete || estimateFlightTime(l.depTime, l.arrTime),
    })));
    if (!quoteNumber && data.quoteNumber) setQuoteNumber(data.quoteNumber);
  };

  const addLeg = () => {
    setLegs(prev => [...prev, {
      id: Date.now(),
      date: '',
      depAirport: '',
      depName: '',
      arrAirport: '',
      arrName: '',
      depTime: '',
      arrTime: '',
      pax: pax || '',
      ete: '',
    }]);
  };

  const updateLeg = (id, field, value) => {
    setLegs(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const removeLeg = (id) => {
    setLegs(prev => prev.filter(l => l.id !== id));
  };

  const addFbo = () => {
    setFboDetails(prev => [...prev, {
      id: Date.now(),
      airport: '',
      name: '',
      address: '',
      phone: '',
    }]);
  };

  const updateFbo = (id, field, value) => {
    setFboDetails(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f));
  };

  const removeFbo = (id) => {
    setFboDetails(prev => prev.filter(f => f.id !== id));
  };

  // ─── INPUT MODE ─────────────────────────────────────────────────
  if (mode === 'input') {
    return (
      <div style={{
        fontFamily: "'Inter', -apple-system, sans-serif",
        backgroundColor: '#F9F8F5',
        minHeight: '100vh',
        color: BRAND.dark,
      }}>
        {/* Header */}
        <div style={{
          backgroundColor: BRAND.dark,
          padding: '20px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <img src={LOGO_SRC} alt="JET365" style={{ height: 32, objectFit: 'contain' }} />
            <span style={{
              fontSize: 13,
              color: BRAND.gold,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              fontWeight: 500,
            }}>Quote Generator</span>
          </div>
          <button
            onClick={() => setMode('preview')}
            style={{
              backgroundColor: BRAND.gold,
              color: BRAND.white,
              border: 'none',
              padding: '10px 24px',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            Preview Quote
          </button>
        </div>

        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 20px' }}>
          {/* Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleFileDrop}
            style={{
              border: `2px dashed ${isDragOver ? BRAND.gold : BRAND.midGray}`,
              borderRadius: 8,
              padding: '32px 24px',
              textAlign: 'center',
              marginBottom: 24,
              backgroundColor: isDragOver ? '#FAF7F0' : BRAND.white,
              transition: 'all 0.2s',
              cursor: 'pointer',
            }}
            onClick={() => document.getElementById('pdfInput')?.click()}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={BRAND.gold} strokeWidth="1.5" style={{ marginBottom: 8 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <polyline points="9 15 12 12 15 15"/>
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600, color: BRAND.dark, marginBottom: 4 }}>
              {fileName ? `Loaded: ${fileName}` : 'Drop Avinode Quote PDF Here'}
            </div>
            <div style={{ fontSize: 12, color: BRAND.textMuted }}>
              or click to browse. Data will be auto-parsed into the fields below.
            </div>
            <input id="pdfInput" type="file" accept=".pdf,.txt" onChange={handleFileDrop} style={{ display: 'none' }} />
          </div>

          {/* Form Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            <FormField label="Client Name" value={clientName} onChange={setClientName} placeholder="Prepared for..." />
            <FormField label="Quote Number" value={quoteNumber} onChange={setQuoteNumber} placeholder="e.g. 42547032" />
            <FormField label="Quote Date" value={quoteDate} onChange={setQuoteDate} placeholder="MM/DD/YY" />
            <FormField label="Aircraft" value={aircraft} onChange={setAircraft} placeholder="e.g. Citation Latitude" />
            <FormField label="Registration" value={registration} onChange={setRegistration} placeholder="e.g. N123AB" />
            <FormField label="Total Price (USD)" value={totalPrice} onChange={setTotalPrice} placeholder="e.g. 45,766.45" />
            <FormField label="Passengers" value={pax} onChange={setPax} placeholder="e.g. 6" />
          </div>

          <FormField label="Amenities" value={amenities} onChange={setAmenities} placeholder="Wi-Fi, Enclosed lavatory, Pets allowed..." fullWidth />

          {/* Photos */}
          <div style={{ marginTop: 24, marginBottom: 24 }}>
            <SectionHeader>Aircraft Photos</SectionHeader>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <PhotoSection
                photo={heroPhoto}
                onPhotoChange={setHeroPhoto}
                onRemove={() => setHeroPhoto(null)}
                label="EXTERIOR PHOTO"
                style={{ height: 180, borderRadius: 6 }}
              />
              <PhotoSection
                photo={cabinPhoto}
                onPhotoChange={setCabinPhoto}
                onRemove={() => setCabinPhoto(null)}
                label="CABIN PHOTO"
                style={{ height: 180, borderRadius: 6 }}
              />
            </div>
          </div>

          {/* Legs */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <SectionHeader style={{ margin: 0 }}>Flight Legs</SectionHeader>
              <button onClick={addLeg} style={addBtnStyle}>+ Add Leg</button>
            </div>
            {legs.map((leg, idx) => (
              <div key={leg.id} style={{
                backgroundColor: BRAND.white,
                border: `1px solid ${BRAND.midGray}`,
                borderRadius: 6,
                padding: 16,
                marginBottom: 8,
                position: 'relative',
              }}>
                <button onClick={() => removeLeg(leg.id)} style={{
                  position: 'absolute', top: 8, right: 8,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#dc2626', fontSize: 16, fontWeight: 'bold',
                }}>✕</button>
                <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.gold, letterSpacing: '0.12em', marginBottom: 8 }}>
                  LEG {idx + 1}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  <MiniField label="Date" value={leg.date} onChange={v => updateLeg(leg.id, 'date', v)} placeholder="MM/DD/YY" />
                  <MiniField label="Dep Airport" value={leg.depAirport} onChange={v => updateLeg(leg.id, 'depAirport', v)} placeholder="KPBI" />
                  <MiniField label="Dep Name" value={leg.depName} onChange={v => updateLeg(leg.id, 'depName', v)} placeholder="Palm Beach Intl" />
                  <MiniField label="Dep Time" value={leg.depTime} onChange={v => updateLeg(leg.id, 'depTime', v)} placeholder="2:00 PM" />
                  <MiniField label="Arr Airport" value={leg.arrAirport} onChange={v => updateLeg(leg.id, 'arrAirport', v)} placeholder="KAGS" />
                  <MiniField label="Arr Name" value={leg.arrName} onChange={v => updateLeg(leg.id, 'arrName', v)} placeholder="Augusta Regional" />
                  <MiniField label="Arr Time" value={leg.arrTime} onChange={v => updateLeg(leg.id, 'arrTime', v)} placeholder="3:24 PM" />
                  <MiniField label="PAX" value={leg.pax} onChange={v => updateLeg(leg.id, 'pax', v)} placeholder="6" />
                </div>
              </div>
            ))}
            {legs.length === 0 && (
              <div style={{ textAlign: 'center', padding: 24, color: BRAND.textMuted, fontSize: 13 }}>
                No legs added. Drop a quote PDF above or click "Add Leg" to start manually.
              </div>
            )}
          </div>

          {/* FBO Details */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <SectionHeader style={{ margin: 0 }}>FBO Details</SectionHeader>
              <button onClick={addFbo} style={addBtnStyle}>+ Add FBO</button>
            </div>
            {fboDetails.map((fbo) => (
              <div key={fbo.id} style={{
                backgroundColor: BRAND.white,
                border: `1px solid ${BRAND.midGray}`,
                borderRadius: 6,
                padding: 16,
                marginBottom: 8,
                position: 'relative',
              }}>
                <button onClick={() => removeFbo(fbo.id)} style={{
                  position: 'absolute', top: 8, right: 8,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#dc2626', fontSize: 16, fontWeight: 'bold',
                }}>✕</button>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  <MiniField label="Airport Code" value={fbo.airport} onChange={v => updateFbo(fbo.id, 'airport', v)} placeholder="KPBI" />
                  <MiniField label="FBO Name" value={fbo.name} onChange={v => updateFbo(fbo.id, 'name', v)} placeholder="Signature Flight Support" />
                  <MiniField label="Address" value={fbo.address} onChange={v => updateFbo(fbo.id, 'address', v)} placeholder="1200 Sky Ln..." />
                  <MiniField label="Phone" value={fbo.phone} onChange={v => updateFbo(fbo.id, 'phone', v)} placeholder="+1 (561) 555-0123" />
                </div>
              </div>
            ))}
          </div>

          {/* Message */}
          <div style={{ marginBottom: 24 }}>
            <SectionHeader>Client Message</SectionHeader>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              style={{
                width: '100%',
                minHeight: 120,
                padding: 12,
                border: `1px solid ${BRAND.midGray}`,
                borderRadius: 6,
                fontFamily: 'inherit',
                fontSize: 13,
                resize: 'vertical',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>

          {/* Raw Text Debug (collapsible) */}
          {rawText && (
            <details style={{ marginBottom: 24 }}>
              <summary style={{ fontSize: 12, color: BRAND.textMuted, cursor: 'pointer' }}>
                View Extracted Raw Text
              </summary>
              <pre style={{
                fontSize: 10,
                backgroundColor: '#f5f5f5',
                padding: 12,
                borderRadius: 4,
                maxHeight: 200,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>{rawText.substring(0, 3000)}</pre>
            </details>
          )}
        </div>
      </div>
    );
  }

  // ─── PREVIEW MODE ───────────────────────────────────────────────
  return (
    <div style={{
      fontFamily: "'Inter', -apple-system, sans-serif",
      backgroundColor: '#E8E4DC',
      minHeight: '100vh',
    }}>
      {/* Toolbar */}
      <div style={{
        backgroundColor: BRAND.dark,
        padding: '12px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <button onClick={() => setMode('input')} style={{
          background: 'none',
          border: `1px solid ${BRAND.gold}`,
          color: BRAND.gold,
          padding: '8px 20px',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          borderRadius: 4,
        }}>
          ← Edit Quote
        </button>
        <span style={{ color: BRAND.white, fontSize: 13, letterSpacing: '0.1em' }}>
          <img src={LOGO_SRC} alt="JET365" style={{ height: 28, objectFit: 'contain' }} />
        </span>
        <button onClick={() => window.print()} style={{
          backgroundColor: BRAND.gold,
          color: BRAND.white,
          border: 'none',
          padding: '8px 20px',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          borderRadius: 4,
        }}>
          Print / Save PDF
        </button>
      </div>

      {/* Quote Document */}
      <div id="quote-document" style={{
        maxWidth: 816,
        margin: '24px auto',
        backgroundColor: BRAND.white,
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
        overflow: 'hidden',
      }}>
        {/* Page Header */}
        <div style={{
          padding: '28px 40px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}>
          <div>
            <img src={LOGO_SRC} alt="JET365" style={{ height: 36, objectFit: 'contain' }} />
            <div style={{ marginTop: 12, fontSize: 12, color: BRAND.dark, lineHeight: 1.6 }}>
              Francesco Figliano<br />
              P: +1 302 208 6118<br />
              sales@jet365.com<br />
              8 The Green, Suite B<br />
              Dover, DE 19901., United States
            </div>
            <div style={{
              height: 2,
              backgroundColor: BRAND.dark,
              width: 200,
              marginTop: 16,
            }} />
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: BRAND.textMuted }}>Prepared for</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: BRAND.dark, marginTop: 4 }}>
                {clientName || '—'}
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: BRAND.dark }}>
                Quote {quoteNumber}
              </div>
              <div style={{ fontSize: 12, color: BRAND.textMuted, marginTop: 4 }}>
                <span style={{ fontWeight: 600 }}>DATE:</span> {quoteDate}
              </div>
              <div style={{ fontSize: 12, color: BRAND.dark, marginTop: 4 }}>
                <span style={{ fontWeight: 600 }}>AIRCRAFT:</span> {aircraft}
              </div>
              {registration && (
                <div style={{ fontSize: 12, color: BRAND.dark, marginTop: 2 }}>
                  <span style={{ fontWeight: 600 }}>REG:</span> {registration}
                </div>
              )}
              {amenities && (
                <div style={{ fontSize: 12, color: BRAND.dark, marginTop: 4 }}>
                  <span style={{ fontWeight: 600 }}>AMENITIES:</span> {amenities}
                </div>
              )}
            </div>
          </div>

          {/* Photo Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            <PhotoSection
              photo={heroPhoto}
              onPhotoChange={setHeroPhoto}
              onRemove={() => setHeroPhoto(null)}
              label="EXTERIOR"
              style={{ width: 340, height: 200, borderRadius: 4 }}
            />
            <PhotoSection
              photo={cabinPhoto}
              onPhotoChange={setCabinPhoto}
              onRemove={() => setCabinPhoto(null)}
              label="CABIN"
              style={{ width: 340, height: 160, borderRadius: 4 }}
            />
          </div>
        </div>

        {/* Itinerary Section */}
        <div style={{ padding: '0 40px' }}>
          <div style={{
            fontSize: 13,
            color: BRAND.textMuted,
            marginBottom: 12,
          }}>
            Itinerary <span style={{ fontSize: 11 }}>(local time)</span>
          </div>

          {/* Table Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '80px 80px 1fr 50px 60px 60px',
            padding: '8px 12px',
            fontSize: 10,
            fontWeight: 700,
            color: BRAND.textMuted,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            borderBottom: `1px solid ${BRAND.midGray}`,
          }}>
            <span>DATE</span>
            <span>ETD / ETA</span>
            <span>DEPART / ARRIVE</span>
            <span style={{ textAlign: 'center' }}>PAX</span>
            <span style={{ textAlign: 'center' }}>ETE</span>
            <span style={{ textAlign: 'center' }}>NM</span>
          </div>

          {/* Legs */}
          {legs.map((leg, idx) => (
            <div key={leg.id} style={{
              display: 'grid',
              gridTemplateColumns: '80px 80px 1fr 50px 60px 60px',
              padding: '10px 12px',
              fontSize: 12,
              color: BRAND.dark,
              borderBottom: `1px solid ${BRAND.lightGray}`,
              lineHeight: 1.5,
            }}>
              <span style={{ fontWeight: 500 }}>{leg.date}</span>
              <div>
                <div>{leg.depTime}</div>
                <div style={{ color: BRAND.textMuted }}>{leg.arrTime}</div>
              </div>
              <div>
                <div>
                  {leg.depName && `${leg.depName}`}
                  {leg.depAirport && <span style={{ color: BRAND.textMuted }}> ({leg.depAirport})</span>}
                </div>
                <div style={{ color: BRAND.textMuted }}>
                  {leg.arrName && `${leg.arrName}`}
                  {leg.arrAirport && <span> ({leg.arrAirport})</span>}
                </div>
              </div>
              <span style={{ textAlign: 'center' }}>{leg.pax}</span>
              <span style={{ textAlign: 'center' }}>{leg.ete || estimateFlightTime(leg.depTime, leg.arrTime)}</span>
              <span style={{ textAlign: 'center', color: BRAND.textMuted }}>—</span>
            </div>
          ))}
        </div>

        {/* Price */}
        <div style={{ padding: '20px 40px' }}>
          <div style={{
            borderTop: `2px solid ${BRAND.gold}`,
            paddingTop: 16,
          }}>
            <div style={{ fontSize: 18, fontWeight: 300, color: BRAND.textMuted }}>Quote</div>
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'baseline',
              gap: 8,
              marginTop: 8,
            }}>
              <span style={{ fontSize: 13, color: BRAND.textMuted }}>Total:</span>
              <span style={{ fontSize: 24, fontWeight: 700, color: BRAND.dark }}>
                $ {totalPrice || '0.00'}
              </span>
            </div>
          </div>
        </div>

        {/* FBO Details */}
        {fboDetails.length > 0 && (
          <div style={{ padding: '0 40px 24px' }}>
            <div style={{
              borderLeft: `3px solid ${BRAND.gold}`,
              paddingLeft: 16,
              marginBottom: 8,
            }}>
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: BRAND.dark,
              }}>FBO DETAILS</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {fboDetails.map(fbo => (
                <div key={fbo.id} style={{
                  border: `1px solid ${BRAND.midGray}`,
                  borderRadius: 6,
                  padding: 14,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {fbo.airport && (
                        <span style={{
                          backgroundColor: BRAND.dark,
                          color: BRAND.white,
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '3px 6px',
                          borderRadius: 3,
                          letterSpacing: '0.05em',
                        }}>{fbo.airport}</span>
                      )}
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{fbo.name}</span>
                    </div>
                    {fbo.phone && <span style={{ fontSize: 11, color: BRAND.textMuted }}>{fbo.phone}</span>}
                  </div>
                  {fbo.address && (
                    <div style={{ fontSize: 11, color: BRAND.textMuted, marginTop: 4 }}>{fbo.address}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Aircraft */}
        {aircraft && (
          <div style={{ padding: '0 40px 24px' }}>
            <div style={{
              borderLeft: `3px solid ${BRAND.gold}`,
              paddingLeft: 16,
              marginBottom: 8,
            }}>
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: BRAND.dark,
              }}>AIRCRAFT</span>
            </div>
            <div style={{
              border: `1px solid ${BRAND.midGray}`,
              borderRadius: 6,
              padding: 14,
            }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{aircraft}</div>
              {registration && <div style={{ fontSize: 12, color: BRAND.textMuted }}>Reg: <strong>{registration}</strong></div>}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{
          borderTop: `1px solid ${BRAND.midGray}`,
          padding: '16px 40px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 10, color: BRAND.textMuted, lineHeight: 1.6 }}>
            JET365 is an air charter broker. JET365 is not an aircraft operator or a direct air carrier and is not in operational control of aircraft.
            Flights will be operated by a direct air carrier or direct foreign air carrier, as applicable, which will have operational control of the aircraft.
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: BRAND.dark }}>
            JET365 Corp | +1 302-208-6118 | info@jet365.com
          </div>
          <div style={{
            marginTop: 8,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: BRAND.gold,
          }}>
            OUR MISSION IS YOUR MISSION
          </div>
        </div>

        {/* Reference Footer */}
        <div style={{
          padding: '8px 40px',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          color: BRAND.textMuted,
          borderTop: `1px solid ${BRAND.lightGray}`,
        }}>
          <span>Reference #{quoteNumber}</span>
          <span style={{ fontWeight: 700 }}>JET365 LLC</span>
          <span>Page 1</span>
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body { margin: 0; padding: 0; background: white; }
          div[style*="sticky"] { display: none !important; }
          #quote-document {
            max-width: 100% !important;
            margin: 0 !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  );
}

// ─── Reusable Components ──────────────────────────────────────────

function SectionHeader({ children, style }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.15em',
      textTransform: 'uppercase',
      color: BRAND.gold,
      marginBottom: 12,
      paddingBottom: 6,
      borderBottom: `1px solid ${BRAND.midGray}`,
      ...style,
    }}>
      {children}
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, fullWidth }) {
  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined, marginBottom: fullWidth ? 0 : undefined }}>
      <label style={{
        display: 'block',
        fontSize: 11,
        fontWeight: 600,
        color: BRAND.textMuted,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginBottom: 4,
      }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '10px 12px',
          border: `1px solid ${BRAND.midGray}`,
          borderRadius: 4,
          fontSize: 13,
          fontFamily: 'inherit',
          boxSizing: 'border-box',
          outline: 'none',
          transition: 'border-color 0.2s',
        }}
        onFocus={e => e.target.style.borderColor = BRAND.gold}
        onBlur={e => e.target.style.borderColor = BRAND.midGray}
      />
    </div>
  );
}

function MiniField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: 9,
        fontWeight: 600,
        color: BRAND.textMuted,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginBottom: 2,
      }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '6px 8px',
          border: `1px solid ${BRAND.midGray}`,
          borderRadius: 3,
          fontSize: 12,
          fontFamily: 'inherit',
          boxSizing: 'border-box',
          outline: 'none',
        }}
        onFocus={e => e.target.style.borderColor = BRAND.gold}
        onBlur={e => e.target.style.borderColor = BRAND.midGray}
      />
    </div>
  );
}

const addBtnStyle = {
  backgroundColor: 'transparent',
  border: `1px solid ${BRAND.gold}`,
  color: BRAND.gold,
  padding: '6px 14px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  cursor: 'pointer',
  borderRadius: 4,
};
