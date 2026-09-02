import { Route, Switch } from "wouter";
import Index from "./pages/index";
import VsCamundaPage from "./pages/vs-camunda";
import { Provider } from "./components/provider";

function App() {
  return (
    <Provider>
      <Switch>
        <Route path="/" component={Index} />
        <Route path="/vs-camunda" component={VsCamundaPage} />
      </Switch>
    </Provider>
  );
}

export default App;
