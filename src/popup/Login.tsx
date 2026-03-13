import { useState } from "react";
import { Phone, Mail, ArrowRight } from "lucide-react";

interface LoginProps {
  onLogin: (email: string, ccEmail?: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState("");
  const [ccEmail, setCcEmail] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = () => {
    const trimmedEmail = email.trim();
    const trimmedCcEmail = ccEmail.trim();

    if (!trimmedEmail) {
      alert("Please enter your email");
      return;
    }

    setIsLoggingIn(true);

    // Simple validation - just check if it looks like an email
    if (!trimmedEmail.includes("@")) {
      alert("Please enter a valid email address");
      setIsLoggingIn(false);
      return;
    }

    if (trimmedCcEmail && !trimmedCcEmail.includes("@")) {
      alert("Please enter a valid CC email address");
      setIsLoggingIn(false);
      return;
    }

    // Save email and proceed
    setTimeout(() => {
      onLogin(trimmedEmail, trimmedCcEmail || undefined);
    }, 500);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleLogin();
    }
  };

  return (
    <div className="w-80 h-[500px] bg-gradient-to-br from-gray-900 to-gray-800 text-white flex flex-col items-center justify-center p-6">
      {/* Logo/Icon */}
      <div className="p-4 bg-purple-500/20 rounded-full mb-6">
        <Phone className="w-12 h-12 text-purple-400" />
      </div>

      {/* Title */}
      <h1 className="text-2xl font-bold mb-2">Simple.Biz Call Coach</h1>
      <p className="text-sm text-gray-400 mb-8 text-center">
        Sign in to start AI-powered coaching
      </p>

      {/* Email Input */}
      <div className="w-full space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-1.5">Email Address</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="you@company.com"
              className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-500 transition-colors"
              disabled={isLoggingIn}
              autoFocus
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5 flex justify-between">
            <span>CC Report To</span>
            <span className="text-xs text-gray-500 font-normal">(Optional)</span>
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="email"
              value={ccEmail}
              onChange={(e) => setCcEmail(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="manager@company.com"
              className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-500 transition-colors"
              disabled={isLoggingIn}
            />
          </div>
        </div>
      </div>

      {/* Login Button */}
      <button
        onClick={handleLogin}
        disabled={isLoggingIn || !email.trim()}
        className="w-full py-3 px-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-lg disabled:cursor-not-allowed"
      >
        {isLoggingIn ? (
          <>
            <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
            Signing in...
          </>
        ) : (
          <>
            Continue
            <ArrowRight className="w-5 h-5" />
          </>
        )}
      </button>

      {/* Info Text */}
      <p className="text-xs text-gray-500 mt-6 text-center">
        Enter your company email to track coaching sessions
      </p>
    </div>
  );
}
