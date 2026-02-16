// AgentFlow — Login Client
const form = document.getElementById('auth-form')
const inputEmail = document.getElementById('input-email')
const inputPassword = document.getElementById('input-password')
const submitBtn = document.getElementById('submit-btn')
const errorMsg = document.getElementById('error-msg')

// Check if already authenticated
fetch('/api/auth/get-session', { credentials: 'include' })
  .then(r => r.ok ? r.json() : null)
  .then(data => {
    if (data?.session) window.location.href = '/'
  })
  .catch(() => {})

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  errorMsg.classList.add('hidden')
  submitBtn.disabled = true
  submitBtn.textContent = 'Signing in...'

  try {
    const res = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email: inputEmail.value.trim(),
        password: inputPassword.value,
      }),
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
    submitBtn.textContent = 'Sign In'
  }
})
