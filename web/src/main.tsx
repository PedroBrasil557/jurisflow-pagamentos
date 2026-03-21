import { RouterProvider } from '@tanstack/react-router'
import ReactDOM from 'react-dom/client'
import { getRouter } from './app/router'
import './styles.css'

const router = getRouter()

const rootElement = document.getElementById('root')

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<RouterProvider router={router} />)
}
