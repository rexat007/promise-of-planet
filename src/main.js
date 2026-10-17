"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = require("react");
const client_1 = require("react-dom/client");
require("./index.css");
require("./i18n");
const App_tsx_1 = require("./App.tsx");
(0, client_1.createRoot)(document.getElementById('root')).render(<react_1.StrictMode>
    <App_tsx_1.default />
  </react_1.StrictMode>);
//# sourceMappingURL=main.js.map