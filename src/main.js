import './style.css'

const app = document.querySelector('#app')

let clickCount = 0

app.innerHTML = `
  <div>
    <h1>🚀 VPS Deployment Template</h1>
    <p>Your web app is running successfully!</p>
    
    <div class="info">
      <p><strong>Status:</strong> ✅ Live and deployed</p>
      <p><strong>Environment:</strong> ${import.meta.env.MODE}</p>
      <div>
        <span class="badge">Vite</span>
        <span class="badge">GitHub Actions</span>
        <span class="badge">VPS Ready</span>
      </div>
    </div>
    
    <button id="counter">Click me! (${clickCount})</button>
  </div>
`

const button = document.querySelector('#counter')
button.addEventListener('click', () => {
  clickCount++
  button.textContent = `Click me! (${clickCount})`
})
