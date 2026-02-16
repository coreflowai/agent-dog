// AgentFlow — Invite Redemption Client
const params = new URLSearchParams(window.location.search)
const token = params.get('token')

const loadingState = document.getElementById('loading-state')
const errorState = document.getElementById('error-state')
const errorReason = document.getElementById('error-reason')
const formState = document.getElementById('form-state')
const formError = document.getElementById('form-error')
const inviteForm = document.getElementById('invite-form')
const inputName = document.getElementById('input-name')
const inputEmail = document.getElementById('input-email')
const inputPassword = document.getElementById('input-password')
const submitBtn = document.getElementById('submit-btn')

function showError(msg) {
  loadingState.classList.add('hidden')
  formState.classList.add('hidden')
  errorState.classList.remove('hidden')
  errorReason.textContent = msg
}

function showForm(email) {
  loadingState.classList.add('hidden')
  errorState.classList.add('hidden')
  formState.classList.remove('hidden')
  if (email) {
    inputEmail.value = email
  }
  inputName.focus()
}

// Validate token on load
async function checkToken() {
  if (!token) {
    showError('No invite token provided.')
    return
  }
  try {
    const res = await fetch(`/api/invites/check?token=${encodeURIComponent(token)}`)
    const data = await res.json()
    if (data.valid) {
      showForm(data.email)
    } else {
      showError(data.reason || 'Invalid invite link.')
    }
  } catch {
    showError('Failed to validate invite. Please try again.')
  }
}

checkToken()

// Handle form submission
inviteForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  formError.classList.add('hidden')
  submitBtn.disabled = true
  submitBtn.textContent = 'Creating...'

  try {
    const res = await fetch('/api/invites/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        name: inputName.value.trim(),
        email: inputEmail.value.trim(),
        password: inputPassword.value,
      }),
    })
    const data = await res.json()
    if (data.ok) {
      window.location.href = '/login.html'
    } else {
      formError.textContent = data.error || 'Failed to create account.'
      formError.classList.remove('hidden')
      submitBtn.disabled = false
      submitBtn.textContent = 'Create Account'
    }
  } catch {
    formError.textContent = 'Network error. Please try again.'
    formError.classList.remove('hidden')
    submitBtn.disabled = false
    submitBtn.textContent = 'Create Account'
  }
})
