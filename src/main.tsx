import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ECUProvider } from "./context/ECUContext";

import App from "./app/App";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ECUProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </ECUProvider>
);
