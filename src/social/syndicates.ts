import { supabase } from '../db/supabase.js';

export class SyndicateEngine {
  
  static async createSyndicate(profileId: string, name: string) {
    // Check if player is already in a syndicate
    const { data: existing } = await supabase
      .from('syndicate_members')
      .select('syndicate_id')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (existing) throw new Error('You are already in a syndicate. Leave it first.');

    // Create syndicate
    const { data: syndicate, error } = await supabase
      .from('syndicates')
      .insert({ name, owner_id: profileId, max_members: 20 })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw new Error('A syndicate with this name already exists.');
      throw new Error('Failed to create syndicate');
    }

    // Add owner as a member
    await supabase.from('syndicate_members').insert({
      syndicate_id: syndicate.id,
      profile_id: profileId,
      role: 'owner'
    });

    return { syndicateId: syndicate.id };
  }

  static async joinSyndicate(profileId: string, syndicateId: string) {
    const { data: memberCount } = await supabase
      .from('syndicate_members')
      .select('profile_id', { count: 'exact' })
      .eq('syndicate_id', syndicateId);

    const { data: syndicate } = await supabase
      .from('syndicates')
      .select('max_members')
      .eq('id', syndicateId)
      .single();

    if (!syndicate) throw new Error('Syndicate not found');
    if (memberCount && memberCount.length >= syndicate.max_members) {
      throw new Error('Syndicate is full');
    }

    // Add member
    const { error } = await supabase.from('syndicate_members').insert({
      syndicate_id: syndicateId,
      profile_id: profileId,
      role: 'member'
    });

    if (error) {
      if (error.code === '23505') throw new Error('You are already a member of this syndicate.');
      throw new Error('Failed to join syndicate. Are you already in one?');
    }

    return { success: true };
  }

  static async leaveSyndicate(profileId: string) {
    const { data: membership } = await supabase
      .from('syndicate_members')
      .select('syndicate_id, role')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (!membership) throw new Error('You are not in a syndicate');

    if (membership.role === 'owner') {
      // For simplicity, if owner leaves, the syndicate is disbanded
      await supabase.from('syndicates').delete().eq('id', membership.syndicate_id);
      return { disbanded: true, syndicateId: membership.syndicate_id };
    } else {
      await supabase.from('syndicate_members')
        .delete()
        .eq('profile_id', profileId)
        .eq('syndicate_id', membership.syndicate_id);
      return { disbanded: false, syndicateId: membership.syndicate_id };
    }
  }

  static async kickMember(ownerId: string, targetProfileId: string) {
    // Verify caller is owner or officer
    const { data: membership } = await supabase
      .from('syndicate_members')
      .select('syndicate_id, role')
      .eq('profile_id', ownerId)
      .maybeSingle();

    if (!membership || (membership.role !== 'owner' && membership.role !== 'officer')) {
      throw new Error('Only the owner or an officer can kick members');
    }

    const { error } = await supabase.from('syndicate_members')
      .delete()
      .eq('profile_id', targetProfileId)
      .eq('syndicate_id', membership.syndicate_id);

    if (error) throw new Error('Failed to kick member');

    return { success: true, syndicateId: membership.syndicate_id };
  }

  static async sendChatMessage(profileId: string, content: string) {
    const { data: membership } = await supabase
      .from('syndicate_members')
      .select('syndicate_id')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (!membership) throw new Error('You must be in a syndicate to chat');

    const { data: chat, error } = await supabase.from('group_chat').insert({
      syndicate_id: membership.syndicate_id,
      sender_id: profileId,
      content
    }).select().single();

    if (error) throw new Error('Failed to send message');

    return chat;
  }

  static async getChatHistory(syndicateId: string, limit = 50) {
    const { data, error } = await supabase
      .from('group_chat')
      .select('id, sender_id, content, created_at')
      .eq('syndicate_id', syndicateId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data.reverse();
  }

  static async getPlayerSyndicate(profileId: string) {
    const { data } = await supabase
      .from('syndicate_members')
      .select('syndicate_id')
      .eq('profile_id', profileId)
      .maybeSingle();
      
    return data?.syndicate_id || null;
  }
}
