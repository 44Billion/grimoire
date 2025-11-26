import { createBrowserRouter, RouterProvider } from "react-router";
import Home from "./components/Home";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Home />,
  },
]);

export default function Root() {
  return <RouterProvider router={router} />;
}
