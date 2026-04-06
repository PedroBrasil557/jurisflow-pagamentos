import { RouterProvider } from '@tanstack/react-router'
import ReactDOM from 'react-dom/client'
import { getRouter } from './app/router'
import './styles.css'

const router = getRouter()

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.location.reload()
})

const rootElement = document.getElementById('root')

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<RouterProvider router={router} />)
}
