import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type Parcel = { id: string; code: string; coefficient: number }
type VoterSession = { token: string; name: string; parcels: Parcel[] }
type Poll = { id: string; question: string; options: string[]; status?: 'open' | 'closed' }
type VoteResult = { inserted_count: number; existing_count: number }
type AdminVote = { option: string; parcel: string; owner: string; castAt: string }

const VOTER_SESSION_KEY = 'asamblea-voter-session'
const POLL_INTERVAL_MS = 15000

function Header({ admin = false }: { admin?: boolean }) {
  return <header className="site-header"><a href={admin ? '#/' : '#admin'} className="brand">Asamblea<span>{admin ? 'Administracion' : 'Propietarios'}</span></a></header>
}

function readVoterSession() {
  const saved = localStorage.getItem(VOTER_SESSION_KEY)
  return saved ? JSON.parse(saved) as VoterSession : null
}

function Register({ onRegistered }: { onRegistered: (session: VoterSession) => void }) {
  const [document, setDocument] = useState('')
  const [parcel, setParcel] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const { data, error: requestError } = await supabase.rpc('start_voter_session', { p_document: document.trim(), p_parcel_code: parcel.trim() })
    setLoading(false)
    if (requestError || !data?.[0]) {
      setError('No encontramos una parcela activa con esos datos.')
      return
    }
    const access = data[0] as { session_token: string; owner_name: string; parcels: Parcel[] }
    const session = { token: access.session_token, name: access.owner_name, parcels: access.parcels }
    localStorage.setItem(VOTER_SESSION_KEY, JSON.stringify(session))
    onRegistered(session)
  }

  return <main className="centered-page"><section className="access-panel" aria-labelledby="access-title"><p className="eyebrow">Asamblea virtual</p><h1 id="access-title">Bienvenido</h1><p className="lead">Ingrese su documento y el numero de una de sus parcelas.</p><form onSubmit={submit} className="access-form"><label htmlFor="document">Numero de documento</label><input id="document" value={document} onChange={(event) => setDocument(event.target.value)} inputMode="numeric" autoComplete="off" required /><label htmlFor="parcel">Parcela</label><input id="parcel" value={parcel} onChange={(event) => setParcel(event.target.value)} autoComplete="off" required />{error && <p className="form-error" role="alert">{error}</p>}<button type="submit" className="primary-button" disabled={loading}>{loading ? 'Verificando...' : 'Continuar'}</button></form></section></main>
}

function VoterRoom({ voter, onLeave }: { voter: VoterSession; onLeave: () => void }) {
  const [poll, setPoll] = useState<Poll | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  async function loadPoll() {
    setLoading(true)
    setMessage('')
    const { data } = await supabase.from('questions').select('id, question, options').eq('status', 'open').maybeSingle()
    setPoll(data ? { id: data.id, question: data.question, options: data.options as string[] } : null)
    setLoading(false)
  }

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) {
        void loadPoll()
      }
    }

    refresh()
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS)
    const handleVisibility = () => {
      if (!document.hidden) {
        void loadPoll()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  async function castVote(option: string) {
    if (!poll || submitting) return
    setSubmitting(true)
    setMessage('')
    const { data, error } = await supabase.rpc('cast_vote', { p_session_token: voter.token, p_question_id: poll.id, p_option: option })
    setSubmitting(false)
    if (error) {
      setMessage('No fue posible registrar el voto. Intente nuevamente.')
      return
    }
    const result = data?.[0] as VoteResult | undefined
    setMessage(result?.inserted_count ? `Su voto fue registrado para ${result.inserted_count} ${result.inserted_count === 1 ? 'parcela.' : 'parcelas.'}` : 'Las parcelas de esta sesion ya habian votado esta pregunta.')
  }

  return <main className="room-page"><div className="room-topline"><div><p className="eyebrow">Participante</p><p className="participant-name">{voter.name}</p><p className="lot-label">{voter.parcels.length === 1 ? '1 parcela habilitada' : `${voter.parcels.length} parcelas habilitadas`}</p></div><button type="button" className="text-button" onClick={onLeave}>Salir</button></div>{loading ? <section className="waiting-state"><p className="status">Cargando</p><h1>Preparando la asamblea</h1></section> : poll ? <section className="ballot" aria-live="polite"><p className="status open">Votacion abierta</p><h1>{poll.question}</h1>{message ? <div className="success-message"><h2>{message}</h2><p>Permanezca en esta pagina para la siguiente pregunta.</p></div> : <div className="options" role="group" aria-label="Opciones de voto">{poll.options.map((option) => <button key={option} type="button" className="option-button" disabled={submitting} onClick={() => void castVote(option)}>{option}</button>)}</div>}</section> : <section className="waiting-state" aria-live="polite"><div className="waiting-mark" aria-hidden="true" /><p className="status">Sala de espera</p><h1>Esperando la siguiente votacion</h1><p>La pregunta aparecera aqui cuando sea habilitada.</p></section>}</main>
}

function AdminLogin({ onLogin }: { onLogin: (session: Session) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (signInError || !data.session) { setError('El correo o la contrasena no son validos.'); return }
    onLogin(data.session)
  }

  return <main className="centered-page"><section className="access-panel" aria-labelledby="admin-title"><p className="eyebrow">Acceso privado</p><h1 id="admin-title">Administracion</h1><form onSubmit={submit} className="access-form"><label htmlFor="admin-email">Correo</label><input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /><label htmlFor="admin-password">Contrasena</label><input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />{error && <p className="form-error" role="alert">{error}</p>}<button type="submit" className="primary-button" disabled={loading}>{loading ? 'Ingresando...' : 'Ingresar'}</button></form></section></main>
}

function Results({ rows, total }: { rows: { option: string; count: number }[]; total: number }) {
  return <div className="results"><p className="vote-count">{total} {total === 1 ? 'voto registrado' : 'votos registrados'}</p>{rows.map(({ option, count }) => { const percentage = total ? Math.round((count / total) * 100) : 0; return <div className="result-row" key={option}><div className="result-label"><span>{option}</span><strong>{count}</strong></div><div className="result-track"><div className="result-fill" style={{ width: `${percentage}%` }} /></div></div> })}</div>
}

function Admin({ onLogout }: { onLogout: () => void }) {
  const [poll, setPoll] = useState<Poll | null>(null)
  const [votes, setVotes] = useState<AdminVote[]>([])
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [error, setError] = useState('')

  async function loadAdminData() {
    const { data: questionData, error: questionError } = await supabase.from('questions').select('id, question, options, status').order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (questionError) { setError('Esta cuenta no tiene permisos de administrador.'); return }
    if (!questionData) { setPoll(null); setVotes([]); return }
    const loadedPoll = { id: questionData.id, question: questionData.question, options: questionData.options as string[], status: questionData.status as 'open' | 'closed' }
    setPoll(loadedPoll)
    const { data: voteData } = await supabase.from('votes').select('parcel_id, selected_option, cast_at').eq('question_id', loadedPoll.id)
    const { data: parcelData } = await supabase.from('parcels').select('id, parcel_code, first_name, last_name')
    const parcelById = new Map((parcelData ?? []).map((parcel) => [parcel.id, parcel]))
    setVotes((voteData ?? []).map((vote) => {
      const parcel = parcelById.get(vote.parcel_id)
      return { option: vote.selected_option, parcel: parcel?.parcel_code ?? '', owner: parcel ? `${parcel.first_name} ${parcel.last_name}` : '', castAt: vote.cast_at }
    }))
  }

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) {
        void loadAdminData()
      }
    }

    refresh()
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS)
    const handleVisibility = () => {
      if (!document.hidden) {
        void loadAdminData()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const resultRows = useMemo(() => (poll?.options ?? []).map((option) => ({ option, count: votes.filter((vote) => vote.option === option).length })), [poll, votes])

  function changeOption(index: number, value: string) { setOptions(options.map((option, optionIndex) => optionIndex === index ? value : option)) }

  async function createPoll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanOptions = options.map((option) => option.trim()).filter(Boolean)
    if (!question.trim() || cleanOptions.length < 2) return
    setError('')
    const { error: insertError } = await supabase.from('questions').insert({ question: question.trim(), options: cleanOptions, status: 'open', opened_at: new Date().toISOString() })
    if (insertError) { setError('No fue posible abrir la votacion. Verifique que no haya otra abierta.'); return }
    setQuestion('')
    setOptions(['', ''])
    await loadAdminData()
  }

  async function closePoll() {
    if (!poll) return
    const { error: updateError } = await supabase.from('questions').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', poll.id)
    if (updateError) { setError('No fue posible cerrar la votacion.'); return }
    await loadAdminData()
  }

  function downloadVotes() {
    if (!poll) return
    const escapeCell = (value: string) => `"${value.replaceAll('"', '""')}"`
    const lines = [['Pregunta', poll.question], [], ['Parcela', 'Propietario', 'Respuesta', 'Fecha y hora']].concat(votes.map((vote) => [vote.parcel, vote.owner, vote.option, new Date(vote.castAt).toLocaleString('es-CO')])).map((row) => row.map(escapeCell).join(';'))
    const file = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = `votos-asamblea-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const showEditor = !poll || poll.status === 'closed'
  return <main className="admin-page"><Header admin /><div className="admin-content"><section className="admin-intro"><p className="eyebrow">Panel de control</p><h1>Votaciones de la asamblea</h1><button type="button" className="text-button" onClick={() => void supabase.auth.signOut().then(onLogout)}>Cerrar sesion</button></section>{error && <p className="form-error" role="alert">{error}</p>}{poll && !showEditor && <section className="live-poll"><div className="live-poll-heading"><div><p className="status open">Votacion abierta</p><h2>{poll.question}</h2></div><div className="admin-actions"><button type="button" className="secondary-button" onClick={downloadVotes}>Descargar votos</button><button type="button" className="danger-button" onClick={() => void closePoll()}>Cerrar votacion</button></div></div><Results rows={resultRows} total={votes.length} /></section>}{poll?.status === 'closed' && <section className="live-poll closed-summary"><div className="live-poll-heading"><div><p className="status">Votacion cerrada</p><h2>{poll.question}</h2></div><button type="button" className="secondary-button" onClick={downloadVotes}>Descargar votos</button></div><Results rows={resultRows} total={votes.length} /></section>}{showEditor && <section className="editor-panel"><h2>{poll ? 'Crear la siguiente votacion' : 'Crear una votacion'}</h2><form onSubmit={(event) => void createPoll(event)} className="poll-form"><label htmlFor="question">Pregunta</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} required /><fieldset><legend>Opciones de respuesta</legend>{options.map((option, index) => <div className="option-field" key={index}><label className="sr-only" htmlFor={`option-${index}`}>Opcion {index + 1}</label><input id={`option-${index}`} value={option} onChange={(event) => changeOption(index, event.target.value)} placeholder={`Opcion ${index + 1}`} required={index < 2} />{options.length > 2 && <button type="button" className="remove-option" onClick={() => setOptions(options.filter((_, optionIndex) => optionIndex !== index))}>Quitar</button>}</div>)}</fieldset><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setOptions([...options, ''])}>Agregar opcion</button><button type="submit" className="primary-button">Abrir votacion</button></div></form></section>}</div></main>
}

export default function App() {
  const [isAdmin, setIsAdmin] = useState(window.location.hash === '#admin')
  const [voter, setVoter] = useState<VoterSession | null>(readVoterSession)
  const [adminSession, setAdminSession] = useState<Session | null>(null)

  useEffect(() => {
    const syncRoute = () => setIsAdmin(window.location.hash === '#admin')
    window.addEventListener('hashchange', syncRoute)
    void supabase.auth.getSession().then(({ data }) => setAdminSession(data.session))
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  if (isAdmin) return <>{adminSession ? <Admin onLogout={() => setAdminSession(null)} /> : <><Header admin /><AdminLogin onLogin={setAdminSession} /></>}</>
  return <><Header />{voter ? <VoterRoom voter={voter} onLeave={() => { localStorage.removeItem(VOTER_SESSION_KEY); setVoter(null) }} /> : <Register onRegistered={setVoter} />}</>
}
