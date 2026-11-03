  const startWithMessage = useStartWithMessage();
  const accountProfile = useQuery(api.workspace.getAccountProfile, {});
  const saveProfile = useMutation(api.workspace.saveProfile);
  const onSaveProfile = async () => {
    try {
      const patch = {
        name: accountProfile?.profile?.name ?? "",
        addressAs: accountProfile?.profile?.addressAs ?? "",
        profession: accountProfile?.profile?.profession ?? "",
        language: accountProfile?.profile?.language ?? "",
        concepts: (accountProfile?.profile?.concepts ?? []).join("\n"),
      };
      await saveProfile(patch);
      toast.success("Profile saved — Jarvis now knows who it's talking to.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    }
  };
