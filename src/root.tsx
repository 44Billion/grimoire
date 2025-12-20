import { createBrowserRouter, RouterProvider } from "react-router";
import Home from "./components/Home";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/preview/:actor/:identifier",
    element: <Home />,
  },
  {
    path: "/:actor/:identifier",
    element: <Home />,
  },
]);

export default function Root() {
  return <RouterProvider router={router} />;
}
