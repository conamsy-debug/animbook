import { SignUp } from "@clerk/nextjs";
import { Topbar } from "@/components/Topbar";

export default function SignUpPage() {
  return (
    <div className="app-shell">
      <Topbar />
      <main className="container" style={{ display: "flex", justifyContent: "center", paddingTop: 40 }}>
        <SignUp
          path="/sign-up"
          routing="path"
          signInUrl="/sign-in"
          afterSignUpUrl="/library"
          appearance={{
            variables: {
              colorPrimary: "#C49A1C",
              colorText: "#F4E9D8",
              colorBackground: "#080C14",
              colorInputBackground: "#101521",
              colorInputText: "#F4E9D8"
            },
            elements: {
              card: { background: "#0F1422", border: "1px solid rgba(196, 154, 28, 0.3)" }
            }
          }}
        />
      </main>
    </div>
  );
}
