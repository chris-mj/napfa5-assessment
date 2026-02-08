import { createContext, useContext } from 'react';

type AuthContextValue = {
  user: any | null;
  openLogin: () => void;
  closeLogin: () => void;
};

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  openLogin: () => {},
  closeLogin: () => {}
});

export function useAuth() {
  return useContext(AuthContext);
}
