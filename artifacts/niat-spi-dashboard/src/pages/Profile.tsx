import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useGetProfile,
  getGetProfileQueryKey,
  useUpdateProfile,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Profile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState(user?.name || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // useGetProfile could be used to fetch fresh details but user from AuthContext is fine for initials

  const updateProfile = useUpdateProfile();

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile.mutate(
      { data: { name } },
      {
        onSuccess: () => {
          toast({
            title: "Profile updated",
            description: "Your profile details have been saved.",
          });
          queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to update profile.",
          });
        },
      },
    );
  };

  const handleUpdatePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast({
        variant: "destructive",
        title: "Invalid password",
        description: "Password must be at least 6 characters.",
      });
      return;
    }

    updateProfile.mutate(
      { data: { currentPassword, newPassword } },
      {
        onSuccess: () => {
          toast({
            title: "Password updated",
            description: "Your password has been changed successfully.",
          });
          setCurrentPassword("");
          setNewPassword("");
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Error",
            description:
              "Failed to update password. Check your current password.",
          });
        },
      },
    );
  };

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Profile"
        subtitle="Manage your account settings and password."
      />

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
          <CardDescription>
            Update your name and view your role details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  value={user?.email || ""}
                  disabled
                  className="bg-gray-50"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Input
                  value={user?.role || ""}
                  disabled
                  className="bg-gray-50 capitalize"
                />
              </div>
            </div>

            <Button type="submit" disabled={updateProfile.isPending}>
              Save Changes
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>
            Ensure your account is using a long, random password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdatePassword} className="space-y-4">
            <div className="space-y-2 max-w-sm">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2 max-w-sm">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <p className="text-xs text-gray-500">Minimum 6 characters.</p>
            </div>

            <Button
              type="submit"
              variant="secondary"
              disabled={updateProfile.isPending}
            >
              Update Password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
