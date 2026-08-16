import React, { useState, useEffect, useRef } from 'react';
import { 
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, 
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, 
  query, where, orderBy, onSnapshot, Timestamp, User 
} from './firebase';
import { getDocFromServer } from 'firebase/firestore';
import { getVeterinaryAdvice, DiagnosisResult, transcribeAudio } from './services/geminiService';
import { 
  Plus, Search, LogOut, User as UserIcon, Dog, Cat, FileText, 
  Printer, History, Upload, ChevronRight, Save, Trash2, X, 
  AlertCircle, CheckCircle2, Loader2, FilePlus, ClipboardList,
  Mic, Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface Patient {
  id: string;
  name: string;
  species: 'dog' | 'cat';
  breed: string;
  weight: number;
  ownerName: string;
  ownerPhone: string;
  createdAt: any;
  createdBy: string;
}

interface Consultation {
  id: string;
  patientId: string;
  date: any;
  symptoms: string;
  diagnosis: string;
  treatment: string;
  medications: DiagnosisResult['medications'];
  suggestedExams: string[];
  examUrls?: string[];
  notes?: string;
  createdBy: string;
}

// --- Components ---

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger', size?: 'sm' | 'md' | 'lg' }>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    const variants = {
      primary: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
      secondary: 'bg-slate-800 text-white hover:bg-slate-900 shadow-sm',
      outline: 'border border-slate-200 bg-transparent hover:bg-slate-50 text-slate-700',
      ghost: 'bg-transparent hover:bg-slate-100 text-slate-600',
      danger: 'bg-rose-500 text-white hover:bg-rose-600 shadow-sm',
    };
    const sizes = {
      sm: 'px-3 py-1.5 text-xs',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
    };
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:pointer-events-none disabled:opacity-50',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);

// --- Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't throw here to avoid crashing the whole app, but we log it clearly
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error) {
      if (error.message.includes('the client is offline')) {
        console.error("Please check your Firebase configuration. ");
      } else if (error.message.includes('permission-denied')) {
        // Ignore permission-denied for the test connection as it might happen before rules propagate
        // or if the collection doesn't exist yet
        console.log("Test connection: permission-denied (expected if rules are still propagating)");
      }
    }
  }
}

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [view, setView] = useState<'dashboard' | 'patient' | 'new-consultation' | 'prescription' | 'prontuario'>('dashboard');
  const [currentConsultation, setCurrentConsultation] = useState<Consultation | null>(null);
  const [isAddingPatient, setIsAddingPatient] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [patientToDelete, setPatientToDelete] = useState<Patient | null>(null);

  useEffect(() => {
    testConnection();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'patients'), where('createdBy', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Patient));
      // Sort by createdAt descending
      docs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setPatients(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'patients');
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!selectedPatient || !user) return;
    const q = query(
      collection(db, 'consultations'), 
      where('patientId', '==', selectedPatient.id),
      where('createdBy', '==', user.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Consultation));
      // Sort by date descending
      docs.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
      setConsultations(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'consultations');
    });
    return () => unsubscribe();
  }, [selectedPatient, user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setView('dashboard');
    setSelectedPatient(null);
  };

  const addPatient = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.currentTarget);
    const newPatient = {
      name: formData.get('name') as string,
      species: formData.get('species') as 'dog' | 'cat',
      breed: formData.get('breed') as string,
      weight: parseFloat(formData.get('weight') as string),
      ownerName: formData.get('ownerName') as string,
      ownerPhone: formData.get('ownerPhone') as string,
      createdAt: Timestamp.now(),
      createdBy: user.uid,
    };
    await addDoc(collection(db, 'patients'), newPatient);
    setIsAddingPatient(false);
  };

  const deletePatient = async (id: string) => {
    await deleteDoc(doc(db, 'patients', id));
    setSelectedPatient(null);
    setPatientToDelete(null);
    setView('dashboard');
  };

  const filteredPatients = patients.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.ownerName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md space-y-8 rounded-2xl bg-white p-8 shadow-xl"
        >
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <Dog className="h-8 w-8 text-emerald-600" />
            </div>
            <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900">VetAI Assistant</h1>
            <p className="mt-2 text-slate-600">Sua inteligência artificial para consultas veterinárias.</p>
          </div>
          <Button onClick={handleLogin} className="w-full" size="lg">
            Entrar com Google
          </Button>
          <div className="text-center text-xs text-slate-400">
            Acesso restrito a médicos veterinários autorizados.
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-bottom border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => { setView('dashboard'); setSelectedPatient(null); }}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
              <Dog className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900 hidden sm:block">VetAI</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5">
              <img src={user.photoURL || ''} alt="" className="h-6 w-6 rounded-full" />
              <span className="text-sm font-medium text-slate-700 hidden sm:block">{user.displayName}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Pacientes</h2>
                  <p className="text-sm text-slate-500">Gerencie seus pacientes e consultas.</p>
                </div>
                <Button onClick={() => setIsAddingPatient(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Novo Paciente
                </Button>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input 
                  placeholder="Buscar por nome do paciente ou proprietário..." 
                  className="pl-10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredPatients.map((patient) => (
                  <motion.div
                    key={patient.id}
                    whileHover={{ y: -4 }}
                    className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-emerald-200 hover:shadow-md"
                    onClick={() => { setSelectedPatient(patient); setView('patient'); }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-50 group-hover:bg-emerald-50">
                        {patient.species === 'dog' ? (
                          <Dog className="h-6 w-6 text-slate-400 group-hover:text-emerald-600" />
                        ) : (
                          <Cat className="h-6 w-6 text-slate-400 group-hover:text-emerald-600" />
                        )}
                      </div>
                      <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-emerald-500" />
                    </div>
                    <div className="mt-4">
                      <h3 className="font-bold text-slate-900">{patient.name}</h3>
                      <p className="text-sm text-slate-500">{patient.breed} • {patient.weight}kg</p>
                    </div>
                    <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-400">
                      <UserIcon className="h-3 w-3" />
                      <span>{patient.ownerName}</span>
                    </div>
                  </motion.div>
                ))}
                {filteredPatients.length === 0 && (
                  <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 py-12 text-center">
                    <History className="h-12 w-12 text-slate-300" />
                    <h3 className="mt-4 text-lg font-medium text-slate-900">Nenhum paciente encontrado</h3>
                    <p className="mt-1 text-sm text-slate-500">Comece adicionando seu primeiro paciente.</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === 'patient' && selectedPatient && (
            <motion.div
              key="patient"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={() => setView('dashboard')}>
                  Voltar
                </Button>
                <div className="h-4 w-px bg-slate-200" />
                <h2 className="text-2xl font-bold text-slate-900">Prontuário: {selectedPatient.name}</h2>
              </div>

              <div className="grid gap-8 lg:grid-cols-3">
                <div className="space-y-6 lg:col-span-1">
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-slate-900">Informações</h3>
                      <Button variant="ghost" size="sm" onClick={() => setPatientToDelete(selectedPatient)}>
                        <Trash2 className="h-4 w-4 text-rose-500" />
                      </Button>
                    </div>
                    <div className="mt-6 space-y-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Espécie</span>
                        <span className="font-medium capitalize">{selectedPatient.species === 'dog' ? 'Cão' : 'Gato'}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Raça</span>
                        <span className="font-medium">{selectedPatient.breed}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Peso</span>
                        <span className="font-medium text-emerald-600">{selectedPatient.weight} kg</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Proprietário</span>
                        <span className="font-medium">{selectedPatient.ownerName}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Telefone</span>
                        <span className="font-medium">{selectedPatient.ownerPhone}</span>
                      </div>
                    </div>
                    <div className="mt-8 flex flex-col gap-2">
                      <Button className="w-full" onClick={() => setView('new-consultation')}>
                        <FilePlus className="mr-2 h-4 w-4" /> Nova Consulta
                      </Button>
                      <Button variant="outline" className="w-full" onClick={() => setView('prontuario')}>
                        <Printer className="mr-2 h-4 w-4" /> Imprimir Prontuário
                      </Button>
                      <Button variant="danger" className="w-full mt-2" onClick={() => setPatientToDelete(selectedPatient)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Deletar Ficha do Animal
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-6 lg:col-span-2">
                  <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                    <History className="h-5 w-5 text-emerald-600" />
                    Histórico de Consultas
                  </h3>
                  <div className="space-y-4">
                    {consultations.map((consultation) => (
                      <div key={consultation.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-slate-500">
                            {new Date(consultation.date.seconds * 1000).toLocaleDateString('pt-BR')}
                          </span>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => { setCurrentConsultation(consultation); setView('prescription'); }}>
                              <Printer className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-4 space-y-2">
                          <h4 className="font-bold text-slate-900">{consultation.diagnosis}</h4>
                          <p className="text-sm text-slate-600 line-clamp-2">{consultation.symptoms}</p>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {consultation.medications.map((med, i) => (
                            <span key={i} className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                              {med.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                    {consultations.length === 0 && (
                      <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 py-12 text-center">
                        <p className="text-sm text-slate-500">Nenhuma consulta registrada.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'new-consultation' && selectedPatient && (
            <NewConsultationView 
              patient={selectedPatient} 
              onBack={() => setView('patient')} 
              onComplete={(consultation) => {
                setCurrentConsultation(consultation);
                setView('patient');
              }}
            />
          )}

          {view === 'prescription' && currentConsultation && selectedPatient && (
            <PrescriptionView 
              consultation={currentConsultation} 
              patient={selectedPatient} 
              onBack={() => setView('patient')} 
            />
          )}

          {view === 'prontuario' && selectedPatient && (
            <ProntuarioView 
              patient={selectedPatient} 
              consultations={consultations} 
              onBack={() => setView('patient')} 
            />
          )}
        </AnimatePresence>
      </main>

      {/* Add Patient Modal */}
      <AnimatePresence>
        {isAddingPatient && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              onClick={() => setIsAddingPatient(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">Novo Paciente</h2>
                <Button variant="ghost" size="sm" onClick={() => setIsAddingPatient(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <form onSubmit={addPatient} className="mt-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Nome do Paciente</label>
                  <Input name="name" required placeholder="Ex: Rex" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Espécie</label>
                    <select name="species" className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                      <option value="dog">Cão</option>
                      <option value="cat">Gato</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Peso (kg)</label>
                    <Input name="weight" type="number" step="0.1" required placeholder="Ex: 10.5" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Raça</label>
                  <Input name="breed" required placeholder="Ex: Golden Retriever" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Proprietário</label>
                  <Input name="ownerName" required placeholder="Nome do dono" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Telefone</label>
                  <Input name="ownerPhone" required placeholder="(00) 00000-0000" />
                </div>
                <Button type="submit" className="w-full mt-4">
                  Salvar Paciente
                </Button>
              </form>
            </motion.div>
          </div>
        )}
        {patientToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              onClick={() => setPatientToDelete(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <h2 className="text-xl font-bold text-rose-600 flex items-center gap-2">
                  <Trash2 className="h-5 w-5" /> Excluir Paciente
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setPatientToDelete(null)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div className="mt-4">
                <p className="text-sm text-slate-600">
                  Tem certeza de que deseja excluir a ficha do paciente <strong className="text-slate-900">{patientToDelete.name}</strong>?
                </p>
                <div className="mt-2 text-xs text-rose-600 bg-rose-50 border border-rose-100 p-3 rounded-lg flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
                  <span>
                    Esta ação é permanente e todos os dados associados a esta ficha serão apagados definitivamente do banco de dados.
                  </span>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-4">
                <Button variant="outline" onClick={() => setPatientToDelete(null)}>
                  Cancelar
                </Button>
                <Button variant="danger" onClick={() => deletePatient(patientToDelete.id)}>
                  Sim, Excluir Ficha
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-Views ---

function NewConsultationView({ patient, onBack, onComplete }: { patient: Patient, onBack: () => void, onComplete: (c: Consultation) => void }) {
  const [symptoms, setSymptoms] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [exams, setExams] = useState<{ data: string; mimeType: string; name: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await handleAudioTranscription(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Erro ao acessar o microfone. Verifique as permissões.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleAudioTranscription = async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        const transcription = await transcribeAudio(base64Audio, blob.type);
        if (transcription) {
          setSymptoms(prev => prev ? `${prev}\n${transcription}` : transcription);
        }
      };
    } catch (error) {
      console.error("Transcription error:", error);
      alert("Erro ao transcrever áudio.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        setExams(prev => [...prev, {
          data: event.target?.result as string,
          mimeType: file.type,
          name: file.name
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeExam = (index: number) => {
    setExams(prev => prev.filter((_, i) => i !== index));
  };

  const handleDiagnose = async () => {
    if (!symptoms) return;
    setLoading(true);
    try {
      const advice = await getVeterinaryAdvice(
        { species: patient.species, breed: patient.breed, weight: patient.weight },
        symptoms,
        exams
      );
      setResult(advice);
    } catch (error) {
      console.error('AI error:', error);
      alert('Erro ao processar diagnóstico. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const saveConsultation = async () => {
    if (!result || !auth.currentUser) return;
    const consultationData = {
      patientId: patient.id,
      date: Timestamp.now(),
      symptoms,
      diagnosis: result.diagnosis,
      treatment: result.treatment,
      medications: result.medications,
      suggestedExams: result.suggestedExams,
      createdBy: auth.currentUser.uid,
    };
    const docRef = await addDoc(collection(db, 'consultations'), consultationData);
    onComplete({ id: docRef.id, ...consultationData } as Consultation);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>Voltar</Button>
        <h2 className="text-2xl font-bold text-slate-900">Nova Consulta</h2>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="font-bold text-slate-900">Anamnese e Sintomas</h3>
            <div className="mt-4 space-y-4">
              <div className="relative">
                <Textarea 
                  placeholder="Descreva os sintomas, comportamento e histórico recente do paciente..." 
                  className="min-h-[200px] pr-12"
                  value={symptoms}
                  onChange={(e) => setSymptoms(e.target.value)}
                />
                <div className="absolute bottom-3 right-3 flex items-center gap-3">
                  {isTranscribing && (
                    <div className="flex items-center gap-2 text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md border border-indigo-100">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Processando áudio...
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={isRecording ? stopRecording : startRecording}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300",
                      isRecording 
                        ? "bg-red-500 text-white animate-pulse shadow-lg shadow-red-200 scale-110" 
                        : "bg-slate-100 text-slate-600 hover:bg-indigo-100 hover:text-indigo-600 shadow-sm"
                    )}
                    title={isRecording ? "Parar Gravação" : "Gravar Áudio"}
                  >
                    {isRecording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Anexar Exames (JPEG/PDF)</label>
                <div 
                  className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-8 transition-colors hover:bg-slate-50"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 text-slate-400" />
                  <p className="mt-2 text-sm text-slate-500">Clique para fazer upload de exames</p>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    multiple 
                    accept="image/*,application/pdf"
                    onChange={handleFileUpload}
                  />
                </div>
                
                {exams.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {exams.map((exam, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
                        <span className="max-w-[100px] truncate">{exam.name}</span>
                        <button onClick={() => removeExam(i)} className="text-slate-400 hover:text-rose-500">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Button 
                className="w-full" 
                size="lg" 
                onClick={handleDiagnose}
                disabled={loading || !symptoms}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Analisando livros e exames...
                  </>
                ) : (
                  <>
                    <ClipboardList className="mr-2 h-4 w-4" />
                    Gerar Diagnóstico e Tratamento
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {result ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-2xl border border-emerald-100 bg-emerald-50/30 p-6 shadow-sm"
            >
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
                <h3 className="font-bold">Análise VetAI Concluída</h3>
              </div>
              
              <div className="mt-6 space-y-6">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Diagnóstico Provável</h4>
                  <p className="mt-1 text-lg font-bold text-slate-900">{result.diagnosis}</p>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Tratamento Recomendado</h4>
                  <div className="prose prose-sm mt-2 text-slate-700">
                    <ReactMarkdown>{result.treatment}</ReactMarkdown>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Medicamentos e Doses (Baseado em {patient.weight}kg)</h4>
                  <div className="mt-2 space-y-3">
                    {result.medications.map((med, i) => (
                      <div key={i} className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
                        <div className="font-bold text-emerald-700">{med.name}</div>
                        <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-slate-500">
                          <div><span className="font-medium text-slate-700">Dose:</span> {med.dosage}</div>
                          <div><span className="font-medium text-slate-700">Freq:</span> {med.frequency}</div>
                          <div><span className="font-medium text-slate-700">Duração:</span> {med.duration}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Exames Complementares Sugeridos</h4>
                  <ul className="mt-2 list-inside list-disc text-sm text-slate-700">
                    {result.suggestedExams.map((exam, i) => <li key={i}>{exam}</li>)}
                  </ul>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Fontes Bibliográficas e Bases de Dados</h4>
                  <ul className="mt-2 list-inside list-disc text-xs text-slate-500">
                    {result.sources.map((source, i) => <li key={i}>{source}</li>)}
                  </ul>
                </div>

                <Button className="w-full" onClick={saveConsultation}>
                  <Save className="mr-2 h-4 w-4" /> Salvar Consulta e Prontuário
                </Button>
              </div>
            </motion.div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center text-slate-400">
              <AlertCircle className="h-12 w-12 opacity-20" />
              <p className="mt-4">Aguardando análise dos sintomas para gerar diagnóstico.</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function PrescriptionView({ consultation, patient, onBack }: { consultation: Consultation, patient: Patient, onBack: () => void }) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Receituário - ${patient.name}</title>
          <style>
            body { font-family: sans-serif; padding: 40px; color: #333; }
            .header { text-align: center; border-bottom: 2px solid #10b981; padding-bottom: 20px; margin-bottom: 40px; }
            .patient-info { margin-bottom: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
            .medication { margin-bottom: 30px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; }
            .med-name { font-size: 1.2rem; font-weight: bold; color: #065f46; margin-bottom: 10px; }
            .med-details { font-size: 0.9rem; color: #4b5563; }
            .footer { margin-top: 80px; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; font-size: 0.8rem; color: #9ca3af; }
            .signature { margin-top: 60px; text-align: center; }
            .sig-line { width: 200px; border-top: 1px solid #333; margin: 0 auto 10px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Receituário Veterinário</h1>
            <p>VetAI Assistant - Inteligência Artificial Clínica</p>
          </div>
          <div class="patient-info">
            <div>
              <strong>Paciente:</strong> ${patient.name}<br>
              <strong>Espécie:</strong> ${patient.species === 'dog' ? 'Cão' : 'Gato'}<br>
              <strong>Peso:</strong> ${patient.weight} kg
            </div>
            <div style="text-align: right;">
              <strong>Data:</strong> ${new Date(consultation.date.seconds * 1000).toLocaleDateString('pt-BR')}<br>
              <strong>Proprietário:</strong> ${patient.ownerName}
            </div>
          </div>
          <div class="content">
            ${consultation.medications.map(med => `
              <div class="medication">
                <div class="med-name">${med.name}</div>
                <div class="med-details">
                  <strong>Dose:</strong> ${med.dosage}<br>
                  <strong>Frequência:</strong> ${med.frequency}<br>
                  <strong>Duração:</strong> ${med.duration}
                </div>
              </div>
            `).join('')}
          </div>
          <div class="signature">
            <div class="sig-line"></div>
            <p>Médico Veterinário</p>
          </div>
          <div class="footer">
            Documento gerado eletronicamente via VetAI Assistant.
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>Voltar</Button>
          <h2 className="text-2xl font-bold text-slate-900">Receituário</h2>
        </div>
        <Button onClick={handlePrint}>
          <Printer className="mr-2 h-4 w-4" /> Imprimir Receita
        </Button>
      </div>

      <div ref={printRef} className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-12 shadow-sm">
        <div className="text-center">
          <Dog className="mx-auto h-12 w-12 text-emerald-600" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Receituário Veterinário</h1>
          <div className="mt-2 h-1 w-24 mx-auto bg-emerald-600 rounded-full" />
        </div>

        <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
          <div className="space-y-2">
            <p><span className="text-slate-500">Paciente:</span> <span className="font-bold">{patient.name}</span></p>
            <p><span className="text-slate-500">Espécie:</span> <span className="font-bold capitalize">{patient.species === 'dog' ? 'Cão' : 'Gato'}</span></p>
            <p><span className="text-slate-500">Peso:</span> <span className="font-bold">{patient.weight} kg</span></p>
          </div>
          <div className="space-y-2 text-right">
            <p><span className="text-slate-500">Data:</span> <span className="font-bold">{new Date(consultation.date.seconds * 1000).toLocaleDateString('pt-BR')}</span></p>
            <p><span className="text-slate-500">Proprietário:</span> <span className="font-bold">{patient.ownerName}</span></p>
          </div>
        </div>

        <div className="mt-12 space-y-8">
          {consultation.medications.map((med, i) => (
            <div key={i} className="border-l-4 border-emerald-500 pl-6">
              <h3 className="text-lg font-bold text-emerald-900">{med.name}</h3>
              <div className="mt-2 space-y-1 text-sm text-slate-600">
                <p><strong>Dose:</strong> {med.dosage}</p>
                <p><strong>Frequência:</strong> {med.frequency}</p>
                <p><strong>Duração:</strong> {med.duration}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-24 text-center">
          <div className="mx-auto h-px w-48 bg-slate-300" />
          <p className="mt-4 text-sm font-medium text-slate-500">Assinatura do Médico Veterinário</p>
        </div>
      </div>
    </div>
  );
}

function ProntuarioView({ patient, consultations, onBack }: { patient: Patient, consultations: Consultation[], onBack: () => void }) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Prontuário - ${patient.name}</title>
          <style>
            body { font-family: sans-serif; padding: 40px; color: #333; line-height: 1.5; }
            .header { text-align: center; border-bottom: 2px solid #10b981; padding-bottom: 20px; margin-bottom: 40px; }
            .patient-card { background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
            .consultation { margin-bottom: 40px; border-bottom: 1px solid #e5e7eb; padding-bottom: 20px; }
            .cons-date { font-weight: bold; color: #059669; margin-bottom: 10px; }
            .cons-diag { font-size: 1.1rem; font-weight: bold; margin-bottom: 10px; }
            .section-title { font-size: 0.8rem; font-weight: bold; text-transform: uppercase; color: #6b7280; margin-top: 15px; }
            .footer { margin-top: 80px; text-align: center; font-size: 0.8rem; color: #9ca3af; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Prontuário Veterinário Completo</h1>
            <p>VetAI Assistant - Histórico Clínico</p>
          </div>
          <div class="patient-card">
            <div>
              <strong>Paciente:</strong> ${patient.name}<br>
              <strong>Espécie:</strong> ${patient.species === 'dog' ? 'Cão' : 'Gato'}<br>
              <strong>Raça:</strong> ${patient.breed}
            </div>
            <div style="text-align: right;">
              <strong>Peso:</strong> ${patient.weight} kg<br>
              <strong>Proprietário:</strong> ${patient.ownerName}<br>
              <strong>Telefone:</strong> ${patient.ownerPhone}
            </div>
          </div>
          <h2>Histórico de Consultas</h2>
          ${consultations.map(c => `
            <div class="consultation">
              <div class="cons-date">${new Date(c.date.seconds * 1000).toLocaleDateString('pt-BR')}</div>
              <div class="cons-diag">${c.diagnosis}</div>
              <div class="section-title">Sintomas</div>
              <p>${c.symptoms}</p>
              <div class="section-title">Tratamento</div>
              <p>${c.treatment}</p>
              <div class="section-title">Medicamentos</div>
              <ul>
                ${c.medications.map(m => `<li>${m.name}: ${m.dosage} - ${m.frequency} (${m.duration})</li>`).join('')}
              </ul>
            </div>
          `).join('')}
          <div class="footer">
            Documento gerado eletronicamente em ${new Date().toLocaleString('pt-BR')}.
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>Voltar</Button>
          <h2 className="text-2xl font-bold text-slate-900">Prontuário Completo</h2>
        </div>
        <Button onClick={handlePrint}>
          <Printer className="mr-2 h-4 w-4" /> Imprimir Prontuário
        </Button>
      </div>

      <div ref={printRef} className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-12 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{patient.name}</h1>
            <p className="text-slate-500">{patient.species === 'dog' ? 'Cão' : 'Gato'} • {patient.breed}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-slate-500">Proprietário</p>
            <p className="text-lg font-bold text-slate-900">{patient.ownerName}</p>
          </div>
        </div>

        <div className="mt-12 space-y-12">
          {consultations.map((c, i) => (
            <div key={c.id} className="relative pl-8">
              <div className="absolute left-0 top-0 h-full w-px bg-slate-100" />
              <div className="absolute left-[-4px] top-2 h-2 w-2 rounded-full bg-emerald-500" />
              
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-emerald-600">
                  {new Date(c.date.seconds * 1000).toLocaleDateString('pt-BR')}
                </span>
              </div>
              
              <div className="mt-4 space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{c.diagnosis}</h3>
                </div>
                
                <div className="grid gap-8 md:grid-cols-2">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Sintomas</h4>
                    <p className="mt-2 text-sm text-slate-600">{c.symptoms}</p>
                    
                    {c.suggestedExams && c.suggestedExams.length > 0 && (
                      <div className="mt-4">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Exames Sugeridos</h4>
                        <ul className="mt-1 list-inside list-disc text-sm text-slate-600">
                          {c.suggestedExams.map((exam, k) => <li key={k}>{exam}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Tratamento</h4>
                    <div className="prose prose-sm mt-2 text-slate-600">
                      <ReactMarkdown>{c.treatment}</ReactMarkdown>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Medicamentos</h4>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {c.medications.map((med, j) => (
                      <div key={j} className="rounded-lg bg-slate-50 p-3 text-xs">
                        <div className="font-bold text-slate-900">{med.name}</div>
                        <div className="mt-1 text-slate-500">{med.dosage} • {med.frequency}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
