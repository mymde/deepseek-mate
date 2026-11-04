import unittest
from motion_sources import transform_evidence, classify_transform


def fixture(paths, attributes=()):
    return ('  m_RotationCurves:\n' + ''.join('  - curve: {}\n    path: ' + p + '\n' for p in paths)
            + '  m_FloatCurves:\n' + ''.join('  - curve: {}\n    attribute: ' + a + '\n' for a in attributes))


class SourceCoverage(unittest.TestCase):
    def test_accessory_parent_is_not_a_body_track(self):
        evidence = transform_evidence(fixture(['Bip001/Bip001 Pelvis/Bip001 L UpperArm/+SleeveS L C01']))
        self.assertEqual(evidence['rotationTracks'], 1)
        self.assertEqual(evidence['bodyRotationPaths'], [])
        self.assertEqual(classify_transform('nEW/test.anim', evidence)[0], 'missing-body')

    def test_exact_body_targets_remain_retarget_candidates(self):
        evidence = transform_evidence(fixture(['Bip001/Bip001 Pelvis', 'Bip001/Bip001 L UpperArm']))
        self.assertEqual(len(evidence['bodyRotationPaths']), 2)
        self.assertEqual(classify_transform('nEW/test.anim', evidence)[0], 'needs-rig')

    def test_thumb_tracks_cannot_stand_in_for_the_body(self):
        evidence = transform_evidence(fixture(['Bip001/Bip001 L Hand/Bip001 L Finger0']))
        self.assertEqual(evidence['bodyRotationPaths'], [])

    def test_hybrid_motion_requires_humanoid_evaluation(self):
        evidence = transform_evidence(fixture(['Bip001/+Hair'], ['Left Arm Down-Up', 'Spine Front-Back']))
        self.assertEqual(classify_transform('nEW/hybrid.anim', evidence)[0], 'needs-unity')

    def test_effect_curve_is_not_a_character_action(self):
        evidence = transform_evidence(fixture(['CameraRoot'], ['material.12345']))
        self.assertEqual(classify_transform('nEW/AnimationClip/Eff_camera.anim', evidence)[0], 'source-asset')


if __name__ == '__main__':
    unittest.main()
