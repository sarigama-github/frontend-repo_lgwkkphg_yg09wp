import { BrowserRouter, Routes, Route, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useState } from 'react'

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_URL || ''
const WS_BASE = (() => {
  const url = BACKEND_HTTP || window.location.origin.replace('3000', '8000')
  if (url.startsWith('https')) return url.replace('https', 'wss')
  if (url.startsWith('http')) return url.replace('http', 'ws')
  // Fallback to current host 8000
  const loc = window.location
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${loc.hostname}:8000`
})()

function Home() {
  const [roomId, setRoomId] = useState(Math.random().toString(36).slice(2, 8))
  const [secret, setSecret] = useState('')
  const navigate = useNavigate()

  const shareLink = `${window.location.origin}/watch/${roomId}${secret ? `?key=${encodeURIComponent(secret)}` : ''}`

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-800 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-3xl bg-white/10 backdrop-blur rounded-2xl border border-white/10 p-8 shadow-xl">
        <h1 className="text-3xl font-bold mb-2">Live Restream</h1>
        <p className="text-white/70 mb-8">Kamu akan menyiarkan video secara langsung tanpa penyimpanan. Bagikan tautan eksklusif untuk menonton.</p>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-black/20 rounded-xl p-5 border border-white/10">
            <h2 className="font-semibold mb-4">Buat Ruangan</h2>
            <label className="block text-sm text-white/70 mb-1">ID Ruangan</label>
            <input value={roomId} onChange={e=>setRoomId(e.target.value)} className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 outline-none focus:border-indigo-400" />
            <label className="block text-sm text-white/70 mt-4 mb-1">Kunci Akses (opsional)</label>
            <input value={secret} onChange={e=>setSecret(e.target.value)} placeholder="Masukkan kata kunci untuk akses" className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 outline-none focus:border-indigo-400" />

            <div className="mt-5 flex gap-3">
              <button onClick={()=>navigate(`/host/${roomId}${secret?`?key=${encodeURIComponent(secret)}`:''}`)} className="px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 font-medium">Mulai sebagai Host</button>
              <Link to={`/watch/${roomId}${secret?`?key=${encodeURIComponent(secret)}`:''}`} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 font-medium">Coba sebagai Penonton</Link>
            </div>
          </div>

          <div className="bg-black/20 rounded-xl p-5 border border-white/10">
            <h2 className="font-semibold mb-3">Bagikan Tautan</h2>
            <div className="flex gap-2">
              <input readOnly value={shareLink} className="flex-1 rounded-lg bg-white/10 border border-white/20 px-3 py-2" />
              <button onClick={()=>{navigator.clipboard.writeText(shareLink)}} className="px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600">Salin</button>
            </div>
            <p className="text-xs text-white/60 mt-2">Siapa pun dengan tautan (dan kunci jika diatur) dapat menonton siaran langsungmu.</p>
          </div>
        </div>

        <div className="mt-8 text-sm text-white/60">Catatan: Media dikirim langsung via WebRTC dan tidak disimpan di server.</div>
      </div>
    </div>
  )
}

function Host() {
  const [params] = useSearchParams()
  const secret = params.get('key') || ''
  const roomId = window.location.pathname.split('/').pop().split('?')[0]
  const [localStream, setLocalStream] = useState(null)
  const [status, setStatus] = useState('Menunggu...')
  const [pcs, setPcs] = useState({})
  const videoRef = (el) => { if (el && localStream) el.srcObject = localStream }

  const wsRef = { current: null }

  const connectWS = () => {
    const ws = new WebSocket(`${WS_BASE.replace(/\/?$/,'')}/ws/${roomId}`)
    wsRef.current = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'identify', role: 'host', secret }))
      setStatus('Terhubung ke server. Menunggu penonton...')
    }
    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'viewer_joined') {
        // placeholder to indicate viewer joined
      }
      if (msg.type === 'offer') {
        const viewerId = msg.viewerId
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
        // Add tracks from local stream
        if (localStream) {
          localStream.getTracks().forEach(t => pc.addTrack(t, localStream))
        }
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate, target: viewerId }))
          }
        }
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        ws.send(JSON.stringify({ type: 'answer', viewerId, sdp: pc.localDescription }))
        setPcs(prev => ({ ...prev, [viewerId]: pc }))
      }
      if (msg.type === 'viewer_left') {
        const pc = pcs[msg.viewerId]
        if (pc) pc.close()
        setPcs(prev => { const n = { ...prev }; delete n[msg.viewerId]; return n })
      }
      if (msg.type === 'ice-candidate' && msg.from) {
        const pc = pcs[msg.from]
        if (pc && msg.candidate) {
          try { await pc.addIceCandidate(msg.candidate) } catch {}
        }
      }
      if (msg.type === 'host_disconnected') {
        setStatus('Terputus')
      }
      if (msg.type === 'error' && msg.message === 'forbidden') {
        setStatus('Kunci akses salah. Tidak dapat menjadi host.')
      }
    }
    ws.onclose = () => setStatus('Koneksi tertutup')
  }

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      setLocalStream(s)
      setStatus('Kamera aktif')
    } catch (e) { setStatus('Gagal mengakses kamera/mikrofon') }
  }
  const startScreen = async () => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      setLocalStream(s)
      setStatus('Berbagi layar aktif')
    } catch (e) { setStatus('Gagal berbagi layar') }
  }

  const stopLocal = () => {
    if (localStream) localStream.getTracks().forEach(t => t.stop())
    setLocalStream(null)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Host Room: {roomId}</h1>
            <p className="text-white/60 text-sm">Status: {status}</p>
          </div>
          <Link to="/" className="text-white/70 hover:text-white">Beranda</Link>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-white/10 rounded-xl border border-white/10 p-4">
            <div className="aspect-video bg-black/40 rounded-lg overflow-hidden">
              <video autoPlay playsInline muted ref={videoRef} className="w-full h-full object-contain"></video>
            </div>
          </div>
          <div className="bg-white/10 rounded-xl border border-white/10 p-4">
            <h2 className="font-semibold mb-3">Kontrol</h2>
            <div className="flex flex-col gap-2">
              <button onClick={startCamera} className="px-3 py-2 rounded bg-indigo-500 hover:bg-indigo-600">Gunakan Kamera</button>
              <button onClick={startScreen} className="px-3 py-2 rounded bg-blue-500 hover:bg-blue-600">Bagikan Layar</button>
              <button onClick={connectWS} className="px-3 py-2 rounded bg-emerald-500 hover:bg-emerald-600">Hubungkan</button>
              <button onClick={stopLocal} className="px-3 py-2 rounded bg-red-500/80 hover:bg-red-600">Hentikan Media</button>
            </div>
            <div className="mt-4 text-xs text-white/60">
              Tautan penonton: <span className="break-all">{`${window.location.origin}/watch/${roomId}${secret?`?key=${encodeURIComponent(secret)}`:''}`}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Watch() {
  const [params] = useSearchParams()
  const secret = params.get('key') || ''
  const roomId = window.location.pathname.split('/').pop().split('?')[0]
  const [status, setStatus] = useState('Mempersiapkan...')
  const [remoteStream, setRemoteStream] = useState(null)
  const videoRef = (el) => { if (el && remoteStream) el.srcObject = remoteStream }

  const start = async () => {
    setStatus('Menghubungkan...')
    const ws = new WebSocket(`${WS_BASE.replace(/\/?$/,'')}/ws/${roomId}`)
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    const remote = new MediaStream()
    setRemoteStream(remote)

    pc.ontrack = (e) => {
      e.streams[0].getTracks().forEach(t => remote.addTrack(t))
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate, target: 'host' }))
      }
    }

    ws.onopen = async () => {
      ws.send(JSON.stringify({ type: 'identify', role: 'viewer', secret }))
    }

    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'ready' && msg.role === 'viewer') {
        // create offer to receive only
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
        await pc.setLocalDescription(offer)
        ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }))
        setStatus('Menunggu jawaban host...')
      }
      if (msg.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
        setStatus('Sedang menonton')
      }
      if (msg.type === 'ice-candidate') {
        try { await pc.addIceCandidate(msg.candidate) } catch {}
      }
      if (msg.type === 'host_disconnected') {
        setStatus('Host terputus')
        pc.close()
      }
      if (msg.type === 'error' && msg.message === 'forbidden') {
        setStatus('Akses ditolak. Kunci salah atau tidak tersedia.')
        ws.close()
      }
    }

    ws.onclose = () => setStatus('Koneksi tertutup')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Menonton: {roomId}</h1>
            <p className="text-white/60 text-sm">Status: {status}</p>
          </div>
          <Link to="/" className="text-white/70 hover:text-white">Beranda</Link>
        </div>

        <div className="bg-white/10 rounded-xl border border-white/10 p-4">
          <div className="aspect-video bg-black/40 rounded-lg overflow-hidden">
            <video autoPlay playsInline ref={videoRef} className="w-full h-full object-contain" controls></video>
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={start} className="px-4 py-2 rounded bg-emerald-500 hover:bg-emerald-600">Mulai Menonton</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host/:id" element={<Host />} />
        <Route path="/watch/:id" element={<Watch />} />
      </Routes>
    </BrowserRouter>
  )
}
