import { RouteObject } from "react-router-dom";
import UsersPage from "./pages/UsersPage";

export const usersRoutes: RouteObject[] = [
  {
    path: "/users",
    element: <UsersPage />,
  },
];
