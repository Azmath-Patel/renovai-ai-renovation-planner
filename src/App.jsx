
import { useEffect, useState } from 'react';
import {
  House, LayoutDashboard, Plus, Wallet,
  FolderKanban, LogOut, LoaderCircle,
  MapPin, CalendarDays, IndianRupee,
  Sparkles, ArrowUpRight, X
} from 'lucide-react';
import { supabase } from './lib/supabase';
import './App.css';

function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState('login');
  const [showForm, setShowForm] = useState(false);
  const [generatingProjectId, setGeneratingProjectId] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectDetails, setProjectDetails] = useState({
  phases: [],
  tasks: [],
  expenses: []
  });
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
  category: 'Materials',
  description: '',
  amount_inr: '',
  vendor: ''
  });

  const [savingExpense, setSavingExpense] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [form, setForm] = useState({
    name: '',
    city: 'Bengaluru',
    property_type: 'Apartment',
    rooms: [],
    renovation_scope: 'Full Home',
    budget_inr: '',
    target_completion_date: ''
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user) {
      fetchProjects();
    } else {
      setProjects([]);
    }
  }, [session?.user?.id]);

  async function fetchProjects() {
    setLoading(true);

    const { data, error } = await supabase
      .from('renovation_projects')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setMessage(error.message);
    } else {
      setProjects(data || []);
    }

    setLoading(false);
  }

  async function handleAuth(e) {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    let result;

    if (mode === 'signup') {
      result = await supabase.auth.signUp({ email, password });

      if (!result.error && !result.data.session) {
        setMessage('Account created. Please confirm your email, then log in.');
      }
    } else {
      result = await supabase.auth.signInWithPassword({ email, password });
    }

    if (result.error) {
      setMessage(result.error.message);
    }

    setLoading(false);
  }

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();

    if (error) setMessage(error.message);
  }

  function toggleRoom(room) {
    setForm((previous) => ({
      ...previous,
      rooms: previous.rooms.includes(room)
        ? previous.rooms.filter((item) => item !== room)
        : [...previous.rooms, room]
    }));
  }

  async function createProject(e) {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    const { error } = await supabase
      .from('renovation_projects')
      .insert({
        owner_id: session.user.id,
        name: form.name.trim(),
        city: form.city.trim(),
        property_type: form.property_type,
        rooms: form.rooms,
        renovation_scope: form.renovation_scope,
        budget_inr: Number(form.budget_inr),
        target_completion_date: form.target_completion_date
      });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage('Renovation project created successfully!');
      setForm({
        name: '',
        city: 'Bengaluru',
        property_type: 'Apartment',
        rooms: [],
        renovation_scope: 'Full Home',
        budget_inr: '',
        target_completion_date: ''
      });
      setShowForm(false);
      await fetchProjects();
    }

    setSaving(false);
  }


async function generatePlan(project) {
  setGeneratingProjectId(project.id);
  setMessage('');

  try {
    // Prevent accidentally creating duplicate plans.
    const { data: existingPhases, error: checkError } = await supabase
      .from('renovation_phases')
      .select('id')
      .eq('project_id', project.id)
      .limit(1);

    if (checkError) throw checkError;

    if (existingPhases?.length) {
      throw new Error('This project already has a saved plan.');
    }

    // Request the plan from the Gemini backend.
    const response = await fetch('http://localhost:3001/api/generate-plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ project }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'AI plan generation failed.');
    }

    const plan = result.plan;

    if (!Array.isArray(plan.phases) || !plan.phases.length) {
      throw new Error('The AI returned an empty plan.');
    }

    const ownerId = session.user.id;
    const taskIds = {};

    // Save phases and their tasks.
    for (const phase of plan.phases) {
      const { data: savedPhase, error: phaseError } = await supabase
        .from('renovation_phases')
        .insert({
          project_id: project.id,
          owner_id: ownerId,
          title: phase.title,
          description: phase.description || '',
          phase_order: Number(phase.phase_order),
          estimated_cost_inr: Number(phase.estimated_cost_inr || 0),
          duration_days: Number(phase.duration_days || 1),
          milestone: phase.milestone || null,
        })
        .select('id')
        .single();

      if (phaseError) throw phaseError;

      for (const [index, task] of (phase.tasks || []).entries()) {
        const taskKey = task.task_key || `phase_${phase.phase_order}_task_${index}`;

        const { data: savedTask, error: taskError } = await supabase
          .from('renovation_tasks')
          .insert({
            project_id: project.id,
            owner_id: ownerId,
            phase_id: savedPhase.id,
            title: task.title,
            description: task.description || '',
            estimated_cost_inr: Number(task.estimated_cost_inr || 0),
            duration_days: Number(task.duration_days || 1),
            is_milestone: Boolean(task.is_milestone),
            status: 'todo',
          })
          .select('id')
          .single();

        if (taskError) throw taskError;

        taskIds[taskKey] = savedTask.id;
      }
    }

    // Save task dependencies after all task IDs are available.
    const dependencies = [];

    for (const phase of plan.phases) {
      for (const task of phase.tasks || []) {
        const taskKey = task.task_key;

        for (const dependencyKey of task.depends_on || []) {
          if (taskIds[taskKey] && taskIds[dependencyKey]) {
            dependencies.push({
              project_id: project.id,
              owner_id: ownerId,
              task_id: taskIds[taskKey],
              depends_on_task_id: taskIds[dependencyKey],
            });
          }
        }
      }
    }

    if (dependencies.length) {
      const { error: dependencyError } = await supabase
        .from('renovation_task_dependencies')
        .insert(dependencies);

      if (dependencyError) throw dependencyError;
    }

    setMessage(
      `AI renovation plan generated and saved for "${project.name}"!`
    );

    await fetchProjects();

  } catch (error) {
    console.error('RenovAI plan error:', error);
    setMessage(error.message || 'Something went wrong while generating the plan.');
  } finally {
    setGeneratingProjectId(null);
  }
}


  async function openProject(project) {
  setSelectedProject(project);
  setDetailsLoading(true);
  setMessage('');

  const [phasesResult, tasksResult, expensesResult] = await Promise.all([
    supabase
      .from('renovation_phases')
      .select('*')
      .eq('project_id', project.id)
      .order('phase_order'),

    supabase
      .from('renovation_tasks')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at'),

    supabase
      .from('renovation_expenses')
      .select('*')
      .eq('project_id', project.id)
      .order('spent_on', { ascending: false })
  ]);

  const error =
    phasesResult.error ||
    tasksResult.error ||
    expensesResult.error;

  if (error) {
    setMessage(error.message);
  } else {
    setProjectDetails({
      phases: phasesResult.data || [],
      tasks: tasksResult.data || [],
      expenses: expensesResult.data || []
    });
  }

  setDetailsLoading(false);
}


async function updateTaskStatus(taskId, newStatus) {
  const { error } = await supabase
    .from('renovation_tasks')
    .update({
      status: newStatus,
      ...(newStatus === 'completed'
        ? { completed_at: new Date().toISOString() }
        : { completed_at: null })
    })
    .eq('id', taskId);

  if (error) {
    setMessage(error.message);
    return;
  }

  setProjectDetails(previous => ({
    ...previous,
    tasks: previous.tasks.map(task =>
      task.id === taskId
        ? { ...task, status: newStatus }
        : task
    )
  }));

  setMessage('Task status updated successfully!');
}

  const completedTasks = projectDetails.tasks.filter(
  task => task.status === 'completed'
).length;

const totalTasks = projectDetails.tasks.length;

const progress = totalTasks === 0
  ? 0
  : Math.round((completedTasks / totalTasks) * 100);

  async function addExpense(e) {
  e.preventDefault();

  if (!selectedProject) return;

  setSavingExpense(true);
  setMessage('');

  const { data, error } = await supabase
    .from('renovation_expenses')
    .insert({
      project_id: selectedProject.id,
      owner_id: session.user.id,
      category: expenseForm.category,
      description: expenseForm.description,
      amount_inr: Number(expenseForm.amount_inr),
      vendor: expenseForm.vendor || null
    })
    .select()
    .single();

  if (error) {
    setMessage(error.message);
  } else {
    setProjectDetails(previous => ({
      ...previous,
      expenses: [data, ...previous.expenses]
    }));

    setExpenseForm({
      category: 'Materials',
      description: '',
      amount_inr: '',
      vendor: ''
    });

    setMessage('Expense recorded successfully!');
  }

  setSavingExpense(false);
}

  const totalBudget = projects.reduce(
    (total, project) => total + Number(project.budget_inr || 0), 0
  );

  const formatINR = (amount) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);

  if (authLoading) {
    return <div className="loading-screen">Loading RenovAI...</div>;
  }

  if (!session) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand-icon"><House size={28} /></div>
          <h1>Renov<span>AI</span></h1>
          <p>Your intelligent home renovation planner.</p>

          <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>

          <form onSubmit={handleAuth}>
            <label>Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />

            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              minLength={6}
              required
            />

            <button className="primary-btn" disabled={loading}>
              {loading ? 'Please wait...' :
                mode === 'login' ? 'Log In' : 'Create Account'}
            </button>
          </form>

          {message && <p className="message">{message}</p>}

          <button
            className="text-btn"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setMessage('');
            }}
          >
            {mode === 'login'
              ? 'New to RenovAI? Create an account'
              : 'Already have an account? Log in'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon"><House size={23} /></div>
          <h2>Renov<span>AI</span></h2>
        </div>

        <p className="nav-label">WORKSPACE</p>
        <div className="nav-item active">
          <LayoutDashboard size={19} /> Dashboard
        </div>
        <div className="nav-item">
          <FolderKanban size={19} /> My Projects
        </div>

        <div className="sidebar-bottom">
          <div className="user-info">
            <div className="avatar">{session.user.email?.[0]?.toUpperCase()}</div>
            <div className="user-email">{session.user.email}</div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={18} /> Log out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <span>Workspace / Dashboard</span>
          <span className="connected"><span className="status-dot"></span> Connected</span>
        </header>

        <section className="welcome-section">
          <div>
            <p className="eyebrow">YOUR RENOVATION WORKSPACE</p>
            <h1>Welcome to RenovAI</h1>
            <p>Plan, manage and track your home renovation projects.</p>
          </div>

          <button className="primary-btn create-btn" onClick={() => setShowForm(true)}>
            <Plus size={19} /> New Project
          </button>
        </section>

        <section className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon purple"><House /></div>
            <p>Total Projects</p>
            <h2>{projects.length}</h2>
            <span>Your renovation projects</span>
          </div>

          <div className="stat-card">
            <div className="stat-icon green"><Wallet /></div>
            <p>Combined Budget</p>
            <h2>{formatINR(totalBudget)}</h2>
            <span>Across all projects</span>
          </div>

          <div className="stat-card">
            <div className="stat-icon orange"><Sparkles /></div>
            <p>AI Planner</p>
            <h2>Coming soon</h2>
            <span>AI-generated renovation plans</span>
          </div>
        </section>

        {message && (
          <div className="message-banner">
            {message}
            <button onClick={() => setMessage('')}><X size={16}/></button>
          </div>
        )}

        <section className="projects-section">
          <div className="section-heading">
            <div>
              <h2>My Projects</h2>
              <p>Manage your renovation projects in one place.</p>
            </div>
            <button className="outline-btn" onClick={fetchProjects}>
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="empty-state">
              <LoaderCircle className="spin" /> Loading projects...
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><House size={30}/></div>
              <h3>No renovation projects yet</h3>
              <p>Create your first project to start planning your dream home.</p>
              <button className="primary-btn" onClick={() => setShowForm(true)}>
                <Plus size={18}/> Create Your First Project
              </button>
            </div>
          ) : (
            <div className="project-grid">
              {projects.map((project) => (
                <article className="project-card" key={project.id}>
                  <div className="project-card-top">
                    <div className="project-icon"><House /></div>
                    <span className="project-status">{project.status}</span>
                  </div>
                  <h3>{project.name}</h3>
                  <p className="project-location">
                    <MapPin size={15}/> {project.city}
                  </p>
                  <div className="project-details">
                    <span><IndianRupee size={15}/> {formatINR(Number(project.budget_inr))}</span>
                    <span><CalendarDays size={15}/> {project.target_completion_date}</span>
                  </div>
                  
                <div className="project-footer">
                  {project.property_type}
                  <ArrowUpRight size={17}/>
                </div>

                <button
                  className="outline-btn"
                  style={{ width: '100%', marginTop: '12px' }}
                  onClick={() => generatePlan(project)}
                  disabled={generatingProjectId !== null}
                >
                  {generatingProjectId === project.id
                    ? 'Generating AI Plan...'
                    : '✨ Generate AI Renovation Plan'}
                </button>
                <button
                  className="outline-btn"
                  style={{ width: '100%', marginTop: '8px' }}
                  onClick={() => openProject(project)}
                >
                  View Project Details
                </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="app-footer">
          RenovAI · Plan smarter. Renovate better.
        </footer>
      </main>


{selectedProject && (
  <div className="modal-backdrop">
    <div
      className="project-modal"
      style={{ maxWidth: '850px', maxHeight: '85vh', overflowY: 'auto' }}
    >
      <div className="modal-heading">
        <div>
          <p className="eyebrow">PROJECT OVERVIEW</p>
          <h2>{selectedProject.name}</h2>
          <p>{selectedProject.city} · {selectedProject.property_type}</p>
        </div>

        <button
          className="close-btn"
          onClick={() => setSelectedProject(null)}
        >
          <X />
        </button>
      </div>

      {detailsLoading ? (
        <p>Loading project details...</p>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <p>Total Budget</p>
              <h2>{formatINR(Number(selectedProject.budget_inr))}</h2>
            </div>

            <div className="stat-card">
              <p>Estimated Plan Cost</p>
              <h2>
                {formatINR(
                  projectDetails.phases.reduce(
                    (sum, phase) => sum + Number(phase.estimated_cost_inr || 0),
                    0
                  )
                )}
              </h2>
            </div>

            <div className="stat-card">
              <p>Tasks Completed</p>
              <h2>
                {projectDetails.tasks.filter(
                  task => task.status === 'completed'
                ).length} / {projectDetails.tasks.length}
              </h2>
            </div>
          </div>

          <div style={{ margin: '20px 0' }}>
  <div style={{
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px'
  }}>
    <strong>Overall Renovation Progress</strong>
    <strong>{progress}%</strong>
  </div>

  <div style={{
    height: '12px',
    background: '#e5e7eb',
    borderRadius: '20px',
    overflow: 'hidden'
  }}>
    <div style={{
      width: `${progress}%`,
      height: '100%',
      background: '#16a34a',
      borderRadius: '20px',
      transition: 'width 0.3s ease'
    }} />
            </div>

            <p style={{ marginTop: '8px' }}>
              {completedTasks} of {totalTasks} tasks completed
            </p>
          </div>

          <h3>Renovation Timeline & Tasks</h3>

          {projectDetails.phases.length === 0 ? (
            <p>No AI plan found. Generate a renovation plan first.</p>
          ) : (
            projectDetails.phases.map(phase => (
              <div
                key={phase.id}
                className="stat-card"
                style={{ marginBottom: '16px' }}
              >
                <h3>
                  Phase {phase.phase_order}: {phase.title}
                </h3>

                <p>{phase.description}</p>

                <p>
                  Estimated cost: {formatINR(Number(phase.estimated_cost_inr))}
                </p>

                <p>Duration: {phase.duration_days} days</p>

                {phase.milestone && (
                  <p>Milestone: {phase.milestone}</p>
                )}

                <div style={{ marginTop: '15px' }}>
                  <strong>Tasks</strong>

                  {projectDetails.tasks
                    .filter(task => task.phase_id === phase.id)
                    .map(task => (
                      <div
                        key={task.id}
                        style={{
                          padding: '12px',
                          marginTop: '8px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px'
                        }}
                      >
                        <strong>{task.title}</strong>
                        <p>{task.description}</p>
                        <p>
                          Estimated cost: {formatINR(Number(task.estimated_cost_inr))}
                        </p>
                        <p>Duration: {task.duration_days} days</p>
                        <label style={{ display: 'block', marginTop: '8px' }}>
  Task Status:
                          <select
                            value={task.status}
                            onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                            style={{ marginLeft: '10px', padding: '6px' }}
                          >
                            <option value="todo">To do</option>
                            <option value="in_progress">In progress</option>
                            <option value="completed">Completed</option>
                          </select>
                        </label>
                      </div>
                    ))}
                </div>
              </div>
            ))
          )}

<h3>Record a New Expense</h3>

<form onSubmit={addExpense} style={{ marginBottom: '24px' }}>
  <label>Expense Category</label>
  <select
    value={expenseForm.category}
    onChange={(e) =>
      setExpenseForm({ ...expenseForm, category: e.target.value })
    }
  >
    <option>Materials</option>
    <option>Labour</option>
    <option>Electrical</option>
    <option>Plumbing</option>
    <option>Carpentry</option>
    <option>Painting</option>
    <option>Other</option>
  </select>

  <label>Expense Description</label>
  <input
    value={expenseForm.description}
    onChange={(e) =>
      setExpenseForm({ ...expenseForm, description: e.target.value })
    }
    placeholder="e.g. Kitchen tiles purchase"
    required
  />

  <label>Amount (INR)</label>
  <input
    type="number"
    min="1"
    value={expenseForm.amount_inr}
    onChange={(e) =>
      setExpenseForm({ ...expenseForm, amount_inr: e.target.value })
    }
    placeholder="e.g. 15000"
    required
  />

  <label>Vendor Name (optional)</label>
  <input
    value={expenseForm.vendor}
    onChange={(e) =>
      setExpenseForm({ ...expenseForm, vendor: e.target.value })
    }
    placeholder="e.g. ABC Interiors"
  />

  <button
    className="primary-btn"
    type="submit"
    disabled={savingExpense}
  >
    {savingExpense ? 'Saving Expense...' : 'Add Expense'}
  </button>
</form>

<div style={{
  padding: '15px',
  background: '#f3f4f6',
  borderRadius: '10px',
  marginBottom: '20px'
}}>
  <strong>Total Actual Spending</strong>
  <h2>
    {formatINR(
      projectDetails.expenses.reduce(
        (sum, expense) => sum + Number(expense.amount_inr || 0),
        0
      )
    )}
  </h2>

  <strong>Remaining Budget</strong>
  <h2>
    {formatINR(
      Number(selectedProject.budget_inr) -
      projectDetails.expenses.reduce(
        (sum, expense) => sum + Number(expense.amount_inr || 0),
        0
      )
    )}
  </h2>
</div>


          <h3>Recorded Expenses</h3>

          {projectDetails.expenses.length === 0 ? (
            <p>No expenses recorded yet.</p>
          ) : (
            projectDetails.expenses.map(expense => (
              <div key={expense.id} style={{ padding: '8px 0' }}>
                {expense.description} — {formatINR(Number(expense.amount_inr))}
              </div>
            ))
          )}
        </>
      )}
    </div>
  </div>
)}


      {showForm && (
        <div className="modal-backdrop">
          <div className="project-modal">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">GET STARTED</p>
                <h2>Create a renovation project</h2>
                <p>Tell us about the home you want to renovate.</p>
              </div>
              <button className="close-btn" onClick={() => setShowForm(false)}>
                <X/>
              </button>
            </div>

            <form onSubmit={createProject}>
              <label>Project name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({...form, name: e.target.value})}
                placeholder="e.g. My Dream Home"
                required
              />

              <div className="form-row">
                <div>
                  <label>City</label>
                  <input
                    value={form.city}
                    onChange={(e) => setForm({...form, city: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label>Property type</label>
                  <select
                    value={form.property_type}
                    onChange={(e) => setForm({...form, property_type: e.target.value})}
                  >
                    <option>Apartment</option>
                    <option>Independent House</option>
                    <option>Villa</option>
                    <option>Other</option>
                  </select>
                </div>
              </div>

              <label>Rooms to renovate</label>
              <div className="room-options">
                {['Living Room', 'Kitchen', 'Bedroom', 'Bathroom', 'Balcony', 'Entire Home'].map(room => (
                  <button
                    type="button"
                    key={room}
                    className={form.rooms.includes(room) ? 'room-chip selected' : 'room-chip'}
                    onClick={() => toggleRoom(room)}
                  >
                    {room}
                  </button>
                ))}
              </div>

              <label>Renovation scope</label>
              <select
                value={form.renovation_scope}
                onChange={(e) => setForm({...form, renovation_scope: e.target.value})}
              >
                <option>Full Home</option>
                <option>Partial Renovation</option>
                <option>Cosmetic Upgrade</option>
                <option>Structural Renovation</option>
              </select>

              <div className="form-row">
                <div>
                  <label>Budget (INR)</label>
                  <input
                    type="number"
                    min="1"
                    value={form.budget_inr}
                    onChange={(e) => setForm({...form, budget_inr: e.target.value})}
                    placeholder="e.g. 1000000"
                    required
                  />
                </div>
                <div>
                  <label>Target completion</label>
                  <input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={form.target_completion_date}
                    onChange={(e) => setForm({...form, target_completion_date: e.target.value})}
                    required
                  />
                </div>
              </div>

              <button className="primary-btn submit-btn" disabled={saving}>
                {saving ? 'Saving project...' : 'Create Project'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
