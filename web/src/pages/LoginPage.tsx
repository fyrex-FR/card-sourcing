import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";

export function LoginPage() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const expired = new URLSearchParams(window.location.search).get("login") === "expired";

  const request = useMutation({ mutationFn: api.requestLogin });
  const verify = useMutation({
    mutationFn: api.verifyCode,
    onSuccess: () => {
      window.history.replaceState(null, "", "/");
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    verify.mutate(code);
  };

  return (
    <div className="login">
      <div className="login-card">
        <img src="/icon.svg" alt="" width={48} height={48} />
        <h1>Alerteur eBay</h1>
        <p className="muted">Connexion sans mot de passe : je t'envoie un lien et un code sur Telegram.</p>

        {expired && !request.isSuccess && <p className="notice error">Ce lien a expiré ou a déjà servi. Demandes-en un nouveau.</p>}

        <button className="button primary block" onClick={() => request.mutate()} disabled={request.isPending}>
          {request.isPending ? "Envoi…" : request.isSuccess ? "Renvoyer un lien" : "Recevoir un lien sur Telegram"}
        </button>
        {request.isError && <p className="notice error">{request.error.message}</p>}

        {request.isSuccess && (
          <form className="code-form" onSubmit={submit}>
            <p className="notice">
              C'est envoyé. Ouvre le lien dans le navigateur à connecter, ou tape ici le code reçu :
            </p>
            <input
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              aria-label="Code reçu sur Telegram"
            />
            <button className="button block" disabled={code.length !== 6 || verify.isPending}>
              Se connecter
            </button>
            {verify.isError && <p className="notice error">{verify.error.message}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
