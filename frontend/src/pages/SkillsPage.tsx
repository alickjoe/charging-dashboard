import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Input, Card, Space, Spin, Typography,
  Modal, List, Checkbox, message, Popconfirm, Empty, Tag,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, ThunderboltOutlined,
  HistoryOutlined, BulbOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useLanguageStore } from '../i18n/store';
import {
  fetchSkills, createSkill, updateSkill, deleteSkill,
  fetchUserQuestions, enhancePrompt,
} from '../api/skills';
import type { Skill, UserQuestion } from '../types';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

export default function SkillsPage() {
  const { t, i18n } = useTranslation();
  const language = useLanguageStore((s) => s.language);
  const queryClient = useQueryClient();

  // ── Skills list ──
  const { data: skills, isLoading: loadingSkills } = useQuery({
    queryKey: ['skills'],
    queryFn: fetchSkills,
  });

  // ── Selected skill for editing ──
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    system_prompt: '',
    user_prompt_template: '',
    source_questions: '[]',
  });
  const [saving, setSaving] = useState(false);
  const [enhancing, setEnhancing] = useState<'system' | 'user' | null>(null);

  // Sidebar toggle for responsive layout
  const [sidebarVisible, setSidebarVisible] = useState(window.innerWidth >= 768);
  useEffect(() => {
    const handleResize = () => setSidebarVisible(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ── History modal ──
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedQuestions, setSelectedQuestions] = useState<UserQuestion[]>([]);
  const { data: userQuestions, isLoading: loadingQuestions } = useQuery({
    queryKey: ['user-questions'],
    queryFn: fetchUserQuestions,
    enabled: historyOpen,
  });

  // ── Handlers ──
  const handleSelectSkill = (skill: Skill) => {
    setSelectedId(skill.id);
    setFormData({
      name: skill.name,
      description: skill.description,
      system_prompt: skill.system_prompt,
      user_prompt_template: skill.user_prompt_template,
      source_questions: skill.source_questions,
    });
  };

  const handleNewSkill = () => {
    setSelectedId(null);
    setFormData({
      name: '',
      description: '',
      system_prompt: '',
      user_prompt_template: '',
      source_questions: '[]',
    });
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      message.warning(t('skills.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      if (selectedId) {
        await updateSkill(selectedId, formData);
        message.success(t('skills.updateSuccess'));
      } else {
        await createSkill(formData);
        message.success(t('skills.createSuccess'));
      }
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(t('skills.saveFailed') + ': ' + msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    await deleteSkill(id);
    if (selectedId === id) handleNewSkill();
    queryClient.invalidateQueries({ queryKey: ['skills'] });
  };

  const handleEnhance = async (field: 'system' | 'user') => {
    const rawPrompt = field === 'system' ? formData.system_prompt : formData.user_prompt_template;
    if (!rawPrompt.trim()) {
      message.warning(t('skills.emptyPrompt'));
      return;
    }
    setEnhancing(field);
    try {
      const result = await enhancePrompt(rawPrompt, language);
      setFormData((prev) => ({
        ...prev,
        [field === 'system' ? 'system_prompt' : 'user_prompt_template']: result.enhanced_prompt,
      }));
      message.success(t('skills.enhanceSuccess'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(t('skills.enhanceFailed') + ': ' + msg);
    } finally {
      setEnhancing(null);
    }
  };

  const handleCreateFromHistory = useCallback(() => {
    if (selectedQuestions.length === 0) {
      message.warning(t('skills.selectAtLeastOne'));
      return;
    }
    const questions = selectedQuestions.map((q) => q.question).join('\n\n');
    setFormData((prev) => ({
      ...prev,
      user_prompt_template: questions,
      source_questions: JSON.stringify(selectedQuestions.map((q) => q.question)),
    }));
    setHistoryOpen(false);
    setSelectedQuestions([]);
  }, [selectedQuestions]);

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 0 }}>
      {/* Sidebar toggle button */}
      <Button
        type="text"
        icon={sidebarVisible ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
        onClick={() => setSidebarVisible(!sidebarVisible)}
        title={sidebarVisible ? t('common.collapse') : t('common.expand')}
        style={{ flexShrink: 0, marginTop: 4 }}
      />

      {/* ─── Left: Skills List ─── */}
      {sidebarVisible && (
      <div style={{
        width: 280, minWidth: 280,
        borderRight: '1px solid #f0f0f0',
        display: 'flex', flexDirection: 'column',
        background: '#fafafa',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            block
            onClick={handleNewSkill}
          >
            {t('skills.create')}
          </Button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {loadingSkills ? (
            <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
          ) : (skills || []).length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('skills.empty')}
              style={{ marginTop: 32 }}
            />
          ) : (
            (skills || []).map((skill) => (
              <div
                key={skill.id}
                onClick={() => handleSelectSkill(skill)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  background: selectedId === skill.id ? '#e6f4ff' : 'transparent',
                  borderLeft: selectedId === skill.id ? '3px solid #1890ff' : '3px solid transparent',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (selectedId !== skill.id)
                    (e.currentTarget as HTMLElement).style.background = '#f0f0f0';
                }}
                onMouseLeave={(e) => {
                  if (selectedId !== skill.id)
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: 500, fontSize: 14,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      <BulbOutlined style={{ marginRight: 6, color: '#faad14' }} />
                      /{skill.name}
                    </div>
                    {skill.description && (
                      <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                        {skill.description}
                      </div>
                    )}
                  </div>
                  <Popconfirm
                    title={t('skills.deleteConfirm')}
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      handleDelete(skill.id);
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                    okText={t('common.delete')}
                    cancelText={t('common.cancel')}
                  >
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => e.stopPropagation()}
                      style={{ flexShrink: 0, marginLeft: 4 }}
                    />
                  </Popconfirm>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      )}

      {/* ─── Right: Edit Form ─── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Text strong style={{ fontSize: 16 }}>
            {selectedId ? t('skills.edit') : t('skills.newSkill')}
          </Text>
          <Button
            icon={<HistoryOutlined />}
            onClick={() => setHistoryOpen(true)}
          >
            {t('skills.fromHistory')}
          </Button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('skills.nameHint')}
          </Text>
          <Input
            addonBefore="/"
            placeholder={t('skills.namePlaceholder')}
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            style={{ marginTop: 4 }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <Text>{t('skills.description')}</Text>
          <Input
            placeholder={t('skills.descPlaceholder')}
            value={formData.description}
            onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
            style={{ marginTop: 4 }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text>{t('skills.systemPrompt')}</Text>
            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              loading={enhancing === 'system'}
              onClick={() => handleEnhance('system')}
            >
              {t('skills.enhance')}
            </Button>
          </div>
          <TextArea
            rows={6}
            placeholder={t('skills.systemPromptPlaceholder')}
            value={formData.system_prompt}
            onChange={(e) => setFormData((prev) => ({ ...prev, system_prompt: e.target.value }))}
            style={{ marginTop: 4, fontFamily: 'monospace' }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('skills.noLanguageOverrideHint')}
          </Text>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text>{t('skills.userPrompt')}</Text>
            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              loading={enhancing === 'user'}
              onClick={() => handleEnhance('user')}
            >
              {t('skills.enhance')}
            </Button>
          </div>
          <TextArea
            rows={6}
            placeholder={t('skills.userPromptPlaceholder')}
            value={formData.user_prompt_template}
            onChange={(e) => setFormData((prev) => ({ ...prev, user_prompt_template: e.target.value }))}
            style={{ marginTop: 4, fontFamily: 'monospace' }}
          />
        </div>

        <Button
          type="primary"
          onClick={handleSave}
          loading={saving}
        >
          {selectedId ? t('skills.update') : t('skills.save')}
        </Button>
      </div>

      {/* ─── History Questions Modal ─── */}
      <Modal
        title={t('skills.selectQuestions')}
        open={historyOpen}
        onCancel={() => { setHistoryOpen(false); setSelectedQuestions([]); }}
        onOk={handleCreateFromHistory}
        okText={t('skills.createFromSelected')}
        width={700}
      >
        {loadingQuestions ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : (
          <Checkbox.Group
            style={{ width: '100%' }}
            value={selectedQuestions.map((q) => q.id)}
            onChange={(checkedValues) => {
              const selected = (userQuestions || []).filter((q) =>
                (checkedValues as number[]).includes(q.id),
              );
              setSelectedQuestions(selected);
            }}
          >
            <List
              dataSource={userQuestions || []}
              renderItem={(item) => (
                <List.Item>
                  <Checkbox value={item.id}>
                    <Paragraph
                      ellipsis={{ rows: 1 }}
                      style={{ margin: 0, maxWidth: 560 }}
                    >
                      {item.question}
                    </Paragraph>
                  </Checkbox>
                </List.Item>
              )}
            />
          </Checkbox.Group>
        )}
      </Modal>
    </div>
  );
}
