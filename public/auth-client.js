// AgentFlow — Login/Signup Client
let isSignUp = false

const form = document.getElementById('auth-form')
const formTitle = document.getElementById('form-title')
const nameField = document.getElementById('name-field')
const inputName = document.getElementById('input-name')
const inputEmail = document.getElementById('input-email')
const inputPassword = document.getElementById('input-password')
const submitBtn = document.getElementById('submit-btn')
const toggleMode = document.getElementById('toggle-mode')
const errorMsg = document.getElementById('error-msg')

// Check if already authenticated
fetch('/api/auth/get-session', { credentials: 'include' })
  .then(r => r.ok ? r.json() : null)
  .then(data => {
    if (data?.session) window.location.href = '/'
  })
  .catch(() => {})

toggleMode.addEventListener('click', () => {
  isSignUp = !isSignUp
  formTitle.textContent = isSignUp ? 'Sign Up' : 'Sign In'
  nameField.classList.toggle('hidden', !isSignUp)
  submitBtn.textContent = isSignUp ? 'Sign Up' : 'Sign In'
  toggleMode.textContent = isSignUp
    ? 'Already have an account? Sign In'
    : "Don't have an account? Sign Up"
  inputPassword.autocomplete = isSignUp ? 'new-password' : 'current-password'
  errorMsg.classList.add('hidden')
})

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  errorMsg.classList.add('hidden')
  submitBtn.disabled = true
  submitBtn.textContent = isSignUp ? 'Signing up...' : 'Signing in...'

  const email = inputEmail.value.trim()
  const password = inputPassword.value
  const name = inputName.value.trim() || email.split('@')[0]

  try {
    const endpoint = isSignUp
      ? '/api/auth/sign-up/email'
      : '/api/auth/sign-in/email'

    const body = isSignUp
      ? { email, password, name }
      : { email, password }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })

    const data = await res.json()

    if (!res.ok || data.error) {
      const msg = data.message || data.error?.message || data.error || 'Authentication failed'
      throw new Error(msg)
    }

    window.location.href = '/'
  } catch (err) {
    errorMsg.textContent = err.message
    errorMsg.classList.remove('hidden')
  } finally {
    submitBtn.disabled = false
    submitBtn.textContent = isSignUp ? 'Sign Up' : 'Sign In'
  }
})
